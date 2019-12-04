/*
Copyright IBM Corp. All Rights Reserved.

SPDX-License-Identifier: Apache-2.0
*/

package main

import (
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/burrow/acm"
	"github.com/hyperledger/burrow/crypto"
	"github.com/hyperledger/burrow/execution/evm"
	"github.com/hyperledger/burrow/logging"
	"github.com/hyperledger/burrow/permission"
	"github.com/hyperledger/fabric-chaincode-evm/evmcc/address"
	"github.com/hyperledger/fabric-chaincode-evm/evmcc/eventmanager"
	"github.com/hyperledger/fabric-chaincode-evm/evmcc/statemanager"
	"github.com/hyperledger/fabric/core/chaincode/shim"
	pb "github.com/hyperledger/fabric/protos/peer"
)

//Permissions for all accounts (users & contracts) to send CallTx or SendTx to a contract
const ContractPermFlags = permission.Call | permission.Send | permission.CreateContract

var logger = shim.NewLogger("evmcc")
var evmLogger = logging.NewNoopLogger()

type EvmChaincode struct{}

func (evmcc *EvmChaincode) Init(stub shim.ChaincodeStubInterface) pb.Response {
	logger.Infof("Init evmcc, it's no-op")
	return shim.Success(nil)
}

func (evmcc *EvmChaincode) Invoke(stub shim.ChaincodeStubInterface) pb.Response {
	startTime := time.Now()
	logger.Infof("Executing TX [%s] with args: %s", stub.GetTxID(), strings.Join(stub.GetStringArgs(), ", "))
	// We always expect 2 args: 'callee address, input data' or ' getCode ,  contract address'
	args := stub.GetArgs()

	if len(args) > 0 {
		if string(args[0]) == "account" {
			return evmcc.account(stub)
		}

		if string(args[0]) == "getBalance" {
			return evmcc.getBalance(stub)
		}
	}

	if (len(args) < 2) || (len(args) > 5) {
		return shim.Error(fmt.Sprintf("expects [2,5] args, got %d : %s", len(args), string(args[0])))
	}

	if string(args[0]) == "getCode" {
		return evmcc.getCode(stub, args[1])
	}

	if string(args[0]) == "addToBalance" {
		return evmcc.modifyBalance(stub, args[1], "add")
	}

	if string(args[0]) == "subtractFromBalance" {
		return evmcc.modifyBalance(stub, args[1], "sub")
	}

	if len(args) == 5 {
		logger.Infof("TX [%s] metadata: %s", stub.GetTxID(), args[4])
	}

	c, err := hex.DecodeString(string(args[0]))
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to decode callee address from %s: %s", string(args[0]), err))
	}

	calleeAddr, err := crypto.AddressFromBytes(c)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to get callee address: %s", err))
	}

	// get caller account from creator public key
	callerAddr, err := getCallerAddress(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to get caller address: %s", err))
	}

	// get input bytes from args[1]
	input, err := hex.DecodeString(string(args[1]))
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to decode input bytes: %s", err))
	}

	var gas uint64 = 10000000
	var weiValue uint64 = 0

	if len(args) >= 3 {
		weiValue, err = strconv.ParseUint(string(args[2]), 10, 64)
		if err != nil {
			return shim.Error(fmt.Sprintf("failed to parse wei value: %s", err))
		} else {
			logger.Infof("Using wei value %d", weiValue)
		}
	}

	nonceString := stub.GetTxID()
	if len(args) == 4 {
		nonceString = string(args[3])
		logger.Infof("Using nonce: %s", nonceString)
	}

	state := statemanager.NewStateManager(stub)
	evmCache := evm.NewState(state, func(height uint64) []byte {
		// This function is to be used to return the block hash
		// Currently EVMCC does not support the BLOCKHASH opcode.
		// This function is only used for that opcode and will not
		// affect execution if BLOCKHASH is not called.
		panic("Block Hash shouldn't be called")
	})
	eventSink := &eventmanager.EventManager{Stub: stub}
	nonce := crypto.Nonce(callerAddr, []byte(nonceString))
	vm := evm.NewVM(newParams(), callerAddr, nonce, evmLogger)

	if calleeAddr == crypto.ZeroAddress {
		logger.Infof("Deploy contract")
		contractAddr := crypto.NewContractAddress(callerAddr, nonce)

		// Contract account needs to be created before setting code to it
		logger.Infof("Creating contract account %s", contractAddr.String())
		evmCache.CreateAccount(contractAddr)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to create the contract account: %s ", evmErr))
		}

		evmCache.SetPermission(contractAddr, ContractPermFlags, true)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to set contract account permissions: %s ", evmErr))
		}

		logger.Infof("Calling EVM. Caller: %s, Callee: %s", calleeAddr.String(), contractAddr.String())
		rtCode, evmErr := vm.Call(evmCache, eventSink, callerAddr, contractAddr, input, input, 0, &gas)
		if evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to deploy code: %s", evmErr))
		}
		if rtCode == nil {
			return shim.Error(fmt.Sprintf("nil bytecode"))
		}

		logger.Infof("Initializing code")
		evmCache.InitCode(contractAddr, rtCode)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to update contract account: %s", evmErr))
		}

		// Passing the first 8 bytes contract address just created
		err := eventSink.Flush(hex.EncodeToString(contractAddr.Bytes()[0:8]))
		if err != nil {
			return shim.Error(fmt.Sprintf("error in Flush: %s", err))
		}

		if evmErr := evmCache.Sync(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to sync: %s", evmErr))
		}
		// return encoded hex bytes for human-readability
		hexEncode := hex.EncodeToString(contractAddr.Bytes())
		logger.Infof("Encoded contract address: %s", hexEncode)
		return shim.Success([]byte(hexEncode))
	} else {
		logger.Infof("Invoke contract at %x", calleeAddr.Bytes())
		logger.Infof("<<MONITOR>>%s;cc_start_epoch_ns;%d<<MONITOR>>", stub.GetTxID(), startTime.UnixNano())

		calleeCode := evmCache.GetCode(calleeAddr)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to retrieve contract code: %s", evmErr))
		}

		evmStart := time.Now()
		logger.Infof("<<MONITOR>>%s;evm_start_epoch_ns;%d<<MONITOR>>", stub.GetTxID(), evmStart.UnixNano())

		output, evmErr := vm.Call(evmCache, eventSink, callerAddr, calleeAddr, calleeCode, input, weiValue, &gas)

		evmEnd := time.Now()
		logger.Infof("<<MONITOR>>%s;evm_end_epoch_ns;%d<<MONITOR>>", stub.GetTxID(), evmStart.UnixNano())
		evmDiff := evmEnd.Sub(evmStart).Nanoseconds()
		logger.Infof("<<MONITOR>>%s;duration_ns_evm;%d<<MONITOR>>", stub.GetTxID(), evmDiff)

		if evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to execute contract: %s", evmErr))
		}

		// Passing the function hash of the method that has triggered the event
		// The function hash is the first 8 bytes of the Input argument
		err := eventSink.Flush(string(args[1][0:8]))
		if err != nil {
			return shim.Error(fmt.Sprintf("error in Flush: %s", err))
		}

		// Sync is required for evm to send writes to the statemanager.
		if evmErr := evmCache.Sync(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to sync: %s", evmErr))
		}

		logTime(startTime, stub)
		return shim.Success(output)
	}
}

func (evmcc *EvmChaincode) getCode(stub shim.ChaincodeStubInterface, address []byte) pb.Response {
	c, err := hex.DecodeString(string(address))
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to decode callee address from %s: %s", string(address), err))
	}

	calleeAddr, err := crypto.AddressFromBytes(c)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to get callee address: %s", err))
	}

	acctBytes, err := stub.GetState(strings.ToLower(calleeAddr.String()))
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to get contract account: %s", err))
	}

	if len(acctBytes) == 0 {
		return shim.Success(acctBytes)
	}

	acct, err := acm.Decode(acctBytes)
	if err != nil {
		return shim.Error(fmt.Sprintf("failed to decode contract account: %s", err))
	}

	return shim.Success([]byte(hex.EncodeToString(acct.Code.Bytes())))
}

func (evmcc *EvmChaincode) account(stub shim.ChaincodeStubInterface) pb.Response {
	callerAddr, err := getCallerAddress(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("fail to convert identity to address: %s", err))
	}
	return shim.Success([]byte(callerAddr.String()))
}

func (evmcc *EvmChaincode) getBalance(stub shim.ChaincodeStubInterface) pb.Response {
	state := statemanager.NewStateManager(stub)
	evmCache := evm.NewState(state, func(height uint64) []byte {
		// This function is to be used to return the block hash
		// Currently EVMCC does not support the BLOCKHASH opcode.
		// This function is only used for that opcode and will not
		// affect execution if BLOCKHASH is not called.
		panic("Block Hash shouldn't be called")
	})

	callerAddress, err := getCallerAddress(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("error while getting caller address: %s", err))
	}

	if !evmCache.Exists(callerAddress) {
		return shim.Success([]byte(strconv.FormatUint(0, 10)))
	}

	return shim.Success([]byte(strconv.FormatUint(evmCache.GetBalance(callerAddress), 10)))
}

func (evmcc *EvmChaincode) modifyBalance(stub shim.ChaincodeStubInterface, valueBytes []byte, op string) pb.Response {
	value, err := strconv.ParseUint(string(valueBytes), 10, 64)
	if err != nil {
		return shim.Error(fmt.Sprintf("error while parsing value in modifyBalance: %s", err))
	}

	state := statemanager.NewStateManager(stub)
	evmCache := evm.NewState(state, func(height uint64) []byte {
		// This function is to be used to return the block hash
		// Currently EVMCC does not support the BLOCKHASH opcode.
		// This function is only used for that opcode and will not
		// affect execution if BLOCKHASH is not called.
		panic("Block Hash shouldn't be called")
	})

	callerAddress, err := getCallerAddress(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("error while getting caller address in modifyBalance: %s", err))
	}

	if !evmCache.Exists(callerAddress) {
		evmCache.CreateAccount(callerAddress)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to create the user account: %s ", evmErr))
		}

		evmCache.SetPermission(callerAddress, ContractPermFlags, true)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to set user account permissions: %s ", evmErr))
		}
	}

	if op == "add" {
		evmCache.AddToBalance(callerAddress, value)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to increase balance: %s ", evmErr))
		}
	} else {
		evmCache.SubtractFromBalance(callerAddress, value)
		if evmErr := evmCache.Error(); evmErr != nil {
			return shim.Error(fmt.Sprintf("failed to decrease balance: %s ", evmErr))
		}
	}

	evmCache.Sync()
	if evmErr := evmCache.Error(); evmErr != nil {
		return shim.Error(fmt.Sprintf("failed to sync EVM cache: %s ", evmErr))
	}

	return shim.Success([]byte(strconv.FormatUint(evmCache.GetBalance(callerAddress), 10)))
}

func logTime(start time.Time, stub shim.ChaincodeStubInterface) {
	endTime := time.Now()
	logger.Infof("<<MONITOR>>%s;cc_end_epoch_ns;%d<<MONITOR>>", stub.GetTxID(), endTime.UnixNano())
	diff := endTime.Sub(start)
	logger.Infof("<<MONITOR>>%s;duration_ns_cc;%d<<MONITOR>>", stub.GetTxID(), diff.Nanoseconds())
}

func newParams() evm.Params {
	return evm.Params{
		BlockHeight: 0,
		BlockTime:   0,
		GasLimit:    0,
	}
}

func getCallerAddress(stub shim.ChaincodeStubInterface) (crypto.Address, error) {
	creatorBytes, err := stub.GetCreator()
	if err != nil {
		return crypto.ZeroAddress, fmt.Errorf("failed to get creator: %s", err)
	}

	callerAddr, err := address.IdentityToAddr(creatorBytes)
	if err != nil {
		return crypto.ZeroAddress, fmt.Errorf("fail to convert identity to address: %s", err)
	}

	return crypto.AddressFromBytes(callerAddr)
}

func main() {
	if err := shim.Start(new(EvmChaincode)); err != nil {
		logger.Errorf("Error starting EVM chaincode: %+v", err)
	}
}
