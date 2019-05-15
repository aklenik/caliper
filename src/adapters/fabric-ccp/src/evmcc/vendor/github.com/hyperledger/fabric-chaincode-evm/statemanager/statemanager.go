/*
Copyright IBM Corp. All Rights Reserved.

SPDX-License-Identifier: Apache-2.0
*/

package statemanager

import (
	"encoding/hex"
	"strings"

	"github.com/hyperledger/burrow/acm"
	"github.com/hyperledger/burrow/binary"
	"github.com/hyperledger/burrow/crypto"
	"github.com/hyperledger/fabric/core/chaincode/shim"
)

var logger = shim.NewLogger("stmngr")

type StateManager interface {
	GetAccount(address crypto.Address) (*acm.Account, error)
	GetStorage(address crypto.Address, key binary.Word256) (binary.Word256, error)
	UpdateAccount(updatedAccount *acm.Account) error
	RemoveAccount(address crypto.Address) error
	SetStorage(address crypto.Address, key, value binary.Word256) error
}

type stateManager struct {
	stub shim.ChaincodeStubInterface
	// We will be looking into adding a cache for accounts later
	// The cache can be single threaded because the statemanager is 1-1 with the evm which is single threaded.
	cache map[string]binary.Word256
	accountCache map[string]*acm.Account
}

func NewStateManager(stub shim.ChaincodeStubInterface) StateManager {
	return &stateManager{
		stub:  stub,
		cache: make(map[string]binary.Word256),
		accountCache: make(map[string]*acm.Account),
	}
}

func (s *stateManager) GetAccount(address crypto.Address) (*acm.Account, error) {
	key := strings.ToLower(address.String())
	logger.Infof("GetAccount: %s", key)

	if val, ok := s.accountCache[key]; ok {
		logger.Infof("GetAccount cache hit: %s, balance: %d, seq: %d", key, val.Balance, val.Sequence)
		return val, nil
	}

	acctBytes, err := s.stub.GetState(key)
	if err != nil {
		return nil, err
	}

	if len(acctBytes) == 0 {
		logger.Infof("GetAccount: %s, doesn't exist", key)
		return nil, nil
	}

	decoded, err := acm.Decode(acctBytes)
	logger.Infof("GetAccount decoded: %s, balance: %d, seq: %d", key, decoded.Balance, decoded.Sequence)
	return decoded, err
}

func (s *stateManager) GetStorage(address crypto.Address, key binary.Word256) (binary.Word256, error) {
	compKey := strings.ToLower(address.String()) + hex.EncodeToString(key.Bytes())
	logger.Infof("GetStorage: %s", compKey)

	if val, ok := s.cache[compKey]; ok {
		logger.Infof("GetStorage cache hit: %s", compKey)
		return val, nil
	}

	val, err := s.stub.GetState(compKey)
	if err != nil {
		return binary.Word256{}, err
	}

	logger.Infof("GetStorage done: %s", compKey)
	return binary.LeftPadWord256(val), nil
}

func (s *stateManager) UpdateAccount(updatedAccount *acm.Account) error {
	encodedAcct, err := updatedAccount.Encode()
	if err != nil {
		return err
	}

	key := hex.EncodeToString(updatedAccount.Address.Bytes())
	logger.Infof("UpdateAccount: %s, balance: %d, sequence: %d", key, updatedAccount.Balance, updatedAccount.Sequence)
	err = s.stub.PutState(key, encodedAcct)

	if err == nil {
		s.accountCache[key] = updatedAccount
	}

	return err
}

func (s *stateManager) RemoveAccount(address crypto.Address) error {
	key := strings.ToLower(address.String())
	logger.Infof("RemoveAccount: %s", key)
	err := s.stub.DelState(key)

	if err == nil {
		delete(s.accountCache, key)
	}

	return err
}

func (s *stateManager) SetStorage(address crypto.Address, key, value binary.Word256) error {
	compKey := strings.ToLower(address.String()) + hex.EncodeToString(key.Bytes())
	logger.Infof("SetStorage: %s", compKey)

	var err error
	if value == binary.Zero256 {
		return s.stub.DelState(compKey)
	}

	if err = s.stub.PutState(compKey, value.Bytes()); err == nil {
		s.cache[compKey] = value
	}

	logger.Infof("SetStorage done: %s", compKey)
	return err
}
