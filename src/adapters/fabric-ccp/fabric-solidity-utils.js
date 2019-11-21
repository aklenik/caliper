/*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

'use strict';

let solc;
let ethabi;
const fs = require('fs');
const path = require('path');

const util = require('../../comm/util.js');
const logger = util.getLogger('adapters/fabric-ccp/solidity');

// list of available stable Solidity compiler version
const solidityCompilerVersions = [
    'v0.1.1+commit.6ff4cd6',
    'v0.1.2+commit.d0d36e3',
    'v0.1.3+commit.28f561',
    'v0.1.4+commit.5f6c3cd',
    'v0.1.5+commit.23865e3',
    'v0.1.6+commit.d41f8b7',
    'v0.1.7+commit.b4e666c',
    'v0.2.0+commit.4dc2445',
    'v0.2.1+commit.91a6b35',
    'v0.2.2+commit.ef92f56',
    'v0.3.0+commit.11d6736',
    'v0.3.1+commit.c492d9b',
    'v0.3.2+commit.81ae2a7',
    'v0.3.3+commit.4dc1cb1',
    'v0.3.4+commit.7dab890',
    'v0.3.5+commit.5f97274',
    'v0.3.6+commit.3fc68da',
    'v0.4.0+commit.acd334c9',
    'v0.4.1+commit.4fc6fc2c',
    'v0.4.2+commit.af6afb04',
    'v0.4.3+commit.2353da71',
    'v0.4.4+commit.4633f3de',
    'v0.4.5+commit.b318366e',
    'v0.4.6+commit.2dabbdf0',
    'v0.4.7+commit.822622cf',
    'v0.4.8+commit.60cc1668',
    'v0.4.9+commit.364da425',
    'v0.4.10+commit.f0d539ae',
    'v0.4.11+commit.68ef5810',
    'v0.4.12+commit.194ff033',
    'v0.4.13+commit.fb4cb1a',
    'v0.4.14+commit.c2215d46',
    'v0.4.15+commit.bbb8e64f',
    'v0.4.16+commit.d7661dd9',
    'v0.4.17+commit.bdeb9e52',
    'v0.4.18+commit.9cf6e910',
    'v0.4.19+commit.c4cbbb05',
    'v0.4.20+commit.3155dd80',
    'v0.4.21+commit.dfe3193c',
    'v0.4.22+commit.4cb486ee',
    'v0.4.23+commit.124ca40d',
    'v0.4.24+commit.e67f0147',
    'v0.4.25+commit.59dbf8f1',
    'v0.5.0+commit.1d4f565a',
    'v0.5.1+commit.c8a2cb62',
    'v0.5.2+commit.1df8f40c',
    'v0.5.3+commit.10d17f24',
    'v0.5.4+commit.9549d8ff',
    'v0.5.5+commit.47a71e8f',
    'v0.5.6+commit.b259423e'
].reverse(); // reverse to match the latest compatible version

// cache the compilers for specific versions since fetching them takes time
let compilerCache = new Map();

class FabricSolidityUtils {
    static load() {
        solc = require('solc');
        ethabi = require('ethereumjs-abi');
    }
    static checkMethodSignatures(contractID, signatures) {
        if (!Array.isArray(signatures)) {
            throw new Error(`The method signatures for ${contractID} must be an array`);
        }

        if (signatures.length < 1) {
            throw new Error(`The method signatures for ${contractID} must contain at least one element`);
        }

        // basic validation of method signatures
        for (let signature of signatures) {
            const signatureRegex = /(.*)\((.*)\)/gm;
            let matches = signatureRegex.exec(signature);

            if (!matches || matches.length < 3) {
                throw new Error(`The method signatures for ${contractID} must be in the 'name(arg1,arg2,...)' form`);
            }
        }
    }

    static encodeMethodToHex(name, args) {
        return ethabi.methodID(name, args).toString('hex');
    }

    static encodeArgsToHex(argTypes, values, bytes) {
        let encodedBytes = ethabi.rawEncode(argTypes, values);
        if (bytes) {
            encodedBytes = encodedBytes.slice(Buffer.byteLength(encodedBytes) - bytes);
        }

        return encodedBytes.toString('hex');
    }

    static encodeAddress(addressHex) {
        return FabricSolidityUtils.encodeArgsToHex(['address'], [ addressHex ], 20);
    }

    static getZeroAddress() {
        return FabricSolidityUtils.encodeAddress('0x0000000000000000000000000000000000000000');
        //return FabricSolidityUtils.encodeArgsToHex(['address'], [ '0x0000000000000000000000000000000000000000' ], bytes || 20);
        //return ethabi.rawEncode(['address'], [ '0x0000000000000000000000000000000000000000' ]).slice(0, 20).toString('hex');
    }

    static getExactCompilerVersion(version) {
        let match = solidityCompilerVersions.find(element => element.startsWith(`v${version}`));
        if (!match) {
            throw new Error(`Couldn't find exact version for ${version}`);
        }

        return match;
    }

    static retrieveCompiler(exactVersion) {
        return new Promise((resolve, reject) => {
            solc.loadRemoteVersion(exactVersion, (err, compiler) => {
                if (err) {
                    reject(err);
                }

                resolve(compiler);
            });
        });
    }

    static getInstalledCompilerVersion() {
        return require('solc/package').version;
    }

    static parseMethodSignatures(completeSignatures) {
        let methodSignatures = {};

        // process signatures, first check which method names are unique
        let isMethodUnique = new Map();
        for (let signature of completeSignatures) {
            const signatureRegex = /(.*?)\((.*?)\)(?::\((.*?)\))?/gm; // declare again, because it's stateful
            let matches = signatureRegex.exec(signature);
            // first match is the whole string, second is the first capture group, third is the second capture group (not needed now)
            if (matches.length < 4) {
                throw new Error(`Invalid Solidity function signature: ${signature}`);
            }

            let methodName = matches[1];
            // first occurence, so far it's unique
            if (!isMethodUnique.has(methodName)) {
                isMethodUnique.set(methodName, true);
            } else {
                // not unique
                isMethodUnique.set(methodName, false);
            }
        }

        // add the ABI part of the contract descriptor
        for (let signature of completeSignatures) {
            const signatureRegex = /(.*?)\((.*?)\)(?::\((.*?)\))?/gm; // declare again, because it's stateful
            let matches = signatureRegex.exec(signature);
            let methodName = matches[1];
            let methodArgs = matches[2].split(',');
            let returnArgs = matches[3].split(',');

            // if the method takes no arguments, denote it by an empty array instead
            if (methodArgs.length === 1 && methodArgs[0] === '') {
                methodArgs = [];
            }

            // if the method returns no value, denote it by an empty array instead
            if (returnArgs.length === 1 && returnArgs[0] === '') {
                returnArgs = [];
            }

            // add the method metadata to the descriptor
            methodSignatures[`${methodName}(${methodArgs})`] = {
                functionHash: FabricSolidityUtils.encodeMethodToHex(methodName, methodArgs),
                argumentTypes: methodArgs,
                returnTypes: returnArgs
            };

            // if the method name alone is also unique, then add a simplified reference for the user module
            if (isMethodUnique.get(methodName)) {
                methodSignatures[methodName] = {
                    functionHash: FabricSolidityUtils.encodeMethodToHex(methodName, methodArgs),
                    argumentTypes: methodArgs,
                    returnTypes: returnArgs
                };
            }
        }

        return methodSignatures;
    }

    static async getCompilerInstance(contractPath, contractCode, detectVersion) {
        let compiler;
        if (detectVersion) {
            const versionRegex = /^pragma solidity\s?[\^<=>]*(\d+(?:\.\d+)?(?:\.\d+)?);/gm;
            let matches = versionRegex.exec(contractCode);
            // first element is the entire statement, the second element is the captured version
            if (!matches || matches.length < 2) {
                throw new Error(`Couldn't retrieve compiler version from Solidity code file ${contractPath}`);
            }

            let version = matches[1];
            if (compilerCache.has(version)) {
                logger.debug(`Solidity compiler v${version} found in cache`);
                compiler = compilerCache.get(version);
            } else if (FabricSolidityUtils.getInstalledCompilerVersion() === version) {
                logger.debug('Installed Solidity compiler version matches with contract requirement');
                compiler = solc;
            } else {
                // retrieve the compiler from its github page
                let exactVersion = FabricSolidityUtils.getExactCompilerVersion(version);
                logger.info(`Retrieving Solidity compiler v${version} (${exactVersion}). This might take some time...`);
                compiler = await FabricSolidityUtils.retrieveCompiler(exactVersion);
                compilerCache.set(version, compiler);
            }
        } else {
            logger.debug(`Using the installed Solidity compiler (v${FabricSolidityUtils.getInstalledCompilerVersion()})`);
            compiler = solc;
        }

        return compiler;
    }

    static async compileContract(contractPath, contractName, detectVersion) {
        let contractCode = fs.readFileSync(contractPath, 'utf-8').toString();
        let compiler = await FabricSolidityUtils.getCompilerInstance(contractPath, contractCode, detectVersion);

        let compilerInput = {
            language: 'Solidity',
            sources: { },
            settings: {
                outputSelection: { }
            }
        };

        let fileName = path.basename(contractPath);

        compilerInput.sources[fileName] = {};
        compilerInput.sources[fileName].content = contractCode;

        // we deploy a single contract at a time, so if multiple contracts are in the same file,
        // then they'll be recompiled again when it's their turn, they're not of interest right now
        compilerInput.settings.outputSelection[fileName] = {};
        compilerInput.settings.outputSelection[fileName][contractName] = ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'];
        logger.debug(`Compiler input for ${contractName}: ${JSON.stringify(compilerInput)}`);
        logger.debug(`Compiling Solidity contract ${contractName}. This might take some time...`);
        let compilerOutput = compiler.compile(JSON.stringify(compilerInput));
        if (typeof compilerOutput === 'string') {
            logger.debug(`Compiler output for ${contractName}: ${compilerOutput}`);
            compilerOutput = JSON.parse(compilerOutput);
        } else {
            logger.debug(`Compiler output for ${contractName}: ${JSON.stringify(compilerOutput)}`);
        }

        if (compilerOutput.errors) {
            let error = false;
            logger.info(`Errors/warnings while compiling ${contractPath}:`);

            compilerOutput.errors.forEach(err => {
                let msg = `\t${err.formattedMessage || err.message || err}`;
                if (err.severity === 'error' || msg.toLowerCase().includes('error')) {
                    logger.error(msg);
                    error = true;
                } else {
                    logger.warn(msg);
                }
            });

            if (error) {
                throw new Error(`Failed to compile ${contractPath}`);
            }
        }

        let contractDetails = compilerOutput.contracts[fileName][contractName];
        let bytecode = contractDetails.evm.bytecode.object;
        let methodIdentifiers = contractDetails.evm.methodIdentifiers;

        logger.debug(`${contractName} bytecode: ${bytecode}`);
        logger.debug(`${contractName} ABI: ${JSON.stringify(contractDetails.abi)}`);
        logger.debug(`${contractName} method identifiers: ${JSON.stringify(methodIdentifiers)}`);

        // discard the function hashes, calculate them when constructing the method signatures
        let signatures = FabricSolidityUtils.abiToSignatures(contractDetails.abi);
        let methodSignatures = FabricSolidityUtils.parseMethodSignatures(signatures);
        FabricSolidityUtils.extractConstructorSignature(contractDetails.abi, methodSignatures);

        return {
            bytecode: bytecode,
            methodSignatures: methodSignatures
        };
    }

    static extractConstructorSignature(abi, methodSignatures) {
        // parse the constructor ABI if any
        for (let element of abi) {
            if (element.type !== 'constructor') {
                continue;
            }

            // no need for the function hash, won't be part of the runtime contract
            // keep the type from the input descriptions (discard the name)
            methodSignatures['#ctr'] = { argumentTypes: element.inputs.map(i => i.type) };
            break; // shouldn't be any more constructor
        }
    }

    static abiToSignatures(abi) {
        let signatures = [];

        // parse the ABI
        for (let element of abi) {
            logger.debug(`Processing ABI element: ${JSON.stringify(element)}`);
            // skip it, since it won't exist in the runtime code
            if (element.type === 'constructor') {
                logger.debug('Skipping "constructor" ABI element');
                continue;
            }

            if (element.type !== 'function') {
                logger.debug(`Skipping "${element.type}" ABI element`);
                continue;
            }

            let inputs = element.inputs.map(i => i.type).join(',');
            let outputs = element.outputs.map(o => o.type).join(',');
            signatures.push(`${element.name}(${inputs}):(${outputs})`);
        }

        return signatures;
    }

    static isConstructorArgsNeeded(signatures) {
        return signatures.hasOwnProperty('#ctr') && signatures['#ctr'].argumentTypes.length > 0;
    }

    static encodeConstructorArguments(abi, args) {
        if (!Array.isArray(args)) {
            args = [args];
        }

        return FabricSolidityUtils.encodeArgsToHex(abi['#ctr'].argumentTypes, args);
        //return ethabi.rawEncode(abi['#ctr'].argumentTypes, args).toString('hex');
    }

    static transformTransactionSettings(evmContractID, evmContractDescriptors, networkUtil, originalSettings) {
        logger.debug(`Transforming for TX: ${JSON.stringify(originalSettings)}`);
        let metadata = `${originalSettings.chaincodeFunction}: ${originalSettings.chaincodeArguments.join('; ')}`;
        let evmProxyDetails = networkUtil.getContractDetails(networkUtil.getEvmProxyChaincodeOfChannel(originalSettings.channel));

        // redirect to the proxy chaincode
        originalSettings.chaincodeId = evmProxyDetails.id;
        originalSettings.chaincodeVersion = evmProxyDetails.version;

        // the proxy chaincode doesn't use it, so meaningless to send
        if (originalSettings.transientMap) {
            logger.warn(`Transient map ignored for solidity contract ${evmContractID}`);
            originalSettings.transientMap = undefined;
        }

        // if invoking evmcc functions, leave everything as is
        if (originalSettings.chaincodeFunction.startsWith('#')) {
            originalSettings.chaincodeFunction = originalSettings.chaincodeFunction.substring(1);
            return;
        }

        let evmMethod = originalSettings.chaincodeFunction;
        let evmMethodDescriptor = evmContractDescriptors[evmContractID].methodSignatures[evmMethod];
        logger.debug(`EVM method descriptor for ${evmMethod}: ${JSON.stringify(evmMethodDescriptor)}`);
        originalSettings.chaincodeFunction = evmContractDescriptors[evmContractID].address;

        let argsHash = evmMethodDescriptor.argumentTypes && evmMethodDescriptor.argumentTypes.length > 0
            ? FabricSolidityUtils.encodeArgsToHex(evmMethodDescriptor.argumentTypes, originalSettings.chaincodeArguments)
            : '';

        // firt argument is the address of the contract, the second is the function hash concatenated with the arguments' hash
        originalSettings.chaincodeArguments = [ evmMethodDescriptor.functionHash + argsHash ];

        // transfer value as the second arg (third, if you count the function name as arg)
        originalSettings.chaincodeArguments.push(
            util.checkProperty(originalSettings, 'weiValue') ? originalSettings.weiValue.toString() : '0'
        );

        // if provided, set nonce as the third arg (fourth, if you count the function name as arg)
        originalSettings.chaincodeArguments.push(
            util.checkProperty(originalSettings, 'nonce') ? originalSettings.nonce.toString() : '0'
        );

        originalSettings.chaincodeArguments.push(metadata);

        logger.debug(`Transformed TX: ${JSON.stringify(originalSettings)}`);
    }
}

module.exports = FabricSolidityUtils;