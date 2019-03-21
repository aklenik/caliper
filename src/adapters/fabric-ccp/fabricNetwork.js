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

const yaml = require('js-yaml');
const fs = require('fs');
const util = require('../../comm/util.js');
const solidityUtil = require('./fabric-solidity-utils.js');
const networkUtil = require('./fabric-network-util.js');

const logger = util.getLogger('adapters/fabric-ccp/network');

/**
 * API for accessing information in a Common Connection Profile configuration
 * (and the Caliper specific extensions) without relying on its structure.
 *
 * @property {object} network The loaded network configuration object.
 * @property {object} clientConfigs The map of client names to their client configuration objects.
 * @property {boolean} compatibilityMode Indicates whether the configuration describes a v1.0 Fabric network.
 * @property {boolean} tls Indicates whether TLS communication is configured for the network.
 * @property {boolean} mutualTls Indicates whether mutual TLS communication is configured for the network.
 * @property {Map<string, {channel:string, id:string, version:string, language: string}>} contractMapping The mapping of contract IDs to chaincode details.
 * @property {Map<string, string>} evmProxies The available EVM proxy contract IDs for each channel.
 * @property {Map<string, boolean>} solidityPresent Indicates whether the channel includes Solidity contracts.
 */
class FabricNetwork {
    /**
     * Loads and verifies the Common Connection Profile settings.
     *
     * @param {string|object} networkConfig The relative or absolute file path, or the object itself of the Common Connection Profile settings.
     */
    constructor(networkConfig) {
        util.assertDefined(networkConfig, 'Parameter \'networkConfig\' if undefined or null');

        if (typeof networkConfig === 'string') {
            let configPath = util.resolvePath(networkConfig);
            this.network = yaml.safeLoad(fs.readFileSync(configPath, 'utf-8'),
                {schema: yaml.DEFAULT_SAFE_SCHEMA});
        } else if (typeof networkConfig === 'object' && networkConfig !== null) {
            // clone the object to prevent modification by other objects
            this.network = yaml.safeLoad(yaml.safeDump(networkConfig), {schema: yaml.DEFAULT_SAFE_SCHEMA});
        } else {
            networkUtil.logAndThrow('Parameter \'networkConfig\' is neither a file path nor an object');
        }

        this.clientConfigs = {};
        this.compatibilityMode = false; // if event URLs are detected for the peers, we're using Fabric 1.0
        this.tls = false;
        this.mutualTls = false;
        this.contractMapping = new Map();
        this.evmProxies = new Map();
        this.solidityPresent = new Map();
        this._validateNetworkConfiguration();
    }

    ////////////////////////////////
    // INTERNAL UTILITY FUNCTIONS //
    ////////////////////////////////

    /**
     * Adds a chaincode description to the given channels chaincode list.
     * @param {string} channel The name of the channel.
     * @param {object} chaincodeObj The object describing the chaincode.
     * @private
     */
    _addChaincodeToChannelConfig(channel, chaincodeObj) {
        this._assertChannelExists(channel);
        this.network.channels[channel].chaincodes.unshift(chaincodeObj);
    }

    /**
     * Throws an error if the client is not present in the configuration.
     * @param {string} client The name of the client.
     * @private
     */
    _assertClientExists(client) {
        if (!this.clientConfigs[client]) {
            networkUtil.logAndThrow(`Couldn't find ${client} in the configuration`);
        }
    }

    /**
     * Throws an error if the organization is not present in the configuration.
     * @param {string} org The name of the organization.
     * @private
     */
    _assertOrgExists(org) {
        if (!this.network.organizations[org]) {
            networkUtil.logAndThrow(`${org} is not found in the configuration`);
        }
    }

    /**
     * Throws an error if the channel is not present in the configuration.
     * @param {string} channel The name of the channel.
     * @private
     */
    _assertChannelExists(channel) {
        if (!this.network.channels[channel]) {
            networkUtil.logAndThrow(`Couldn't find ${channel} in the configuration`);
        }
    }

    /**
     * Throws an error if the peer is not present in the configuration.
     * @param {string} peer The name of the peer.
     * @private
     */
    _assertPeerExists(peer) {
        if (!this.network.peers[peer]) {
            networkUtil.logAndThrow(`Couldn't find ${peer} in the configuration`);
        }
    }

    /**
     * Throws an error if the CA is not present in the configuration.
     * @param {string} ca The name of the CA.
     * @private
     */
    _assertCaExists(ca) {
        if (!this.network.certificateAuthorities[ca]) {
            networkUtil.logAndThrow(`Couldn't find ${ca} in the configuration`);
        }
    }

    /**
     * Internal utility function for validating that the Common Connection Profile
     * setting contains every required property.
     *
     * @private
     */
    _validateNetworkConfiguration() {
        // top level properties
        // CAs are only needed when a user enrollment or registration is needed
        let requiredCas = new Set();
        let providedCas = new Set();

        util.assertAllProperties(this.network, 'network',
            'caliper', 'clients', 'channels', 'organizations', 'orderers', 'peers');

        util.assertProperty(this.network.caliper, 'network.caliper', 'blockchain');

        this.mutualTls = util.checkProperty(this.network, 'mutual-tls') ? this.network['mutual-tls'] : false;

        // ===========
        // = CLIENTS =
        // ===========

        let clients = this.getClients();
        if (clients.size < 1) {
            networkUtil.logAndThrow('The \'clients\' section does not contain any entries');
        }

        for (let client of clients) {
            let clientObjectName = `network.clients.${client}`;
            let clientObject = this.network.clients[client];

            util.assertProperty(clientObject, clientObjectName, 'client');
            this.clientConfigs[client] = this.network.clients[client];

            // include the client level for convenience
            clientObject = this.network.clients[client].client;
            clientObjectName = `network.clients.${client}.client`;

            util.assertAllProperties(clientObject, clientObjectName, 'organization', 'credentialStore');
            util.assertAllProperties(clientObject.credentialStore, `${clientObjectName}.credentialStore`, 'path', 'cryptoStore');
            util.assertProperty(clientObject.credentialStore.cryptoStore, `${clientObjectName}.credentialStore.cryptoStore`, 'path');

            // normalize paths
            clientObject.credentialStore.path = util.resolvePath(clientObject.credentialStore.path);
            clientObject.credentialStore.cryptoStore.path = util.resolvePath(clientObject.credentialStore.cryptoStore.path);

            // user identity can be provided in multiple ways
            // if there is any crypto content info, every crypto content info is needed
            if (util.checkAnyProperty(clientObject, 'clientPrivateKey', 'clientSignedCert')) {
                util.assertAllProperties(clientObject, clientObjectName, 'clientPrivateKey', 'clientSignedCert');

                // either file path or pem content is needed
                util.assertAnyProperty(clientObject.clientPrivateKey, `${clientObjectName}.clientPrivateKey`, 'path', 'pem');
                util.assertAnyProperty(clientObject.clientSignedCert, `${clientObjectName}.clientSignedCert`, 'path', 'pem');

                // normalize the paths if provided
                if (util.checkProperty(clientObject.clientPrivateKey, 'path')) {
                    clientObject.clientPrivateKey.path = util.resolvePath(clientObject.clientPrivateKey.path);
                }

                if (util.checkProperty(clientObject.clientSignedCert, 'path')) {
                    clientObject.clientSignedCert.path = util.resolvePath(clientObject.clientSignedCert.path);
                }
            } else if (util.checkProperty(clientObject, 'enrollSecret')) {
                // otherwise, enrollment info can also be specified and the CA will be needed
                // TODO: currently only one CA is supported
                requiredCas.add(this.getOrganizationOfClient(client));
            } else {
                // if no crypto material or enrollment info is provided, then registration and CA info is needed
                util.assertProperty(clientObject, clientObjectName, 'affiliation');
                // TODO: currently only one CA is supported
                requiredCas.add(this.getOrganizationOfClient(client));
            }


        }

        // ============
        // = CHANNELS =
        // ============
        let channels = this.getChannels();
        if (channels.size < 1) {
            networkUtil.logAndThrow('The \'channels\' section does not contain any entries');
        }

        for (let channel of channels) {
            let channelObj = this.network.channels[channel];
            let channelObjName = `network.channels.${channel}`;

            // if the channel is not created, we need the configuration artifacts
            // created defaults to false
            if (!util.checkProperty(channelObj, 'created') || !channelObj.created) {
                // one kind of config is needed
                if (!util.checkProperty(channelObj, 'configBinary')) {
                    util.assertAllProperties(channelObj, channelObjName, 'configUpdateObject', 'configtxlatorPath');
                }
            }

            // mandatory top-level properties
            util.assertAllProperties(channelObj, channelObjName, 'orderers', 'peers', 'chaincodes');

            // ====================
            // = CHANNEL ORDERERS =
            // ====================
            networkUtil.assertAllNodesExist(channelObj.orderers, Object.keys(this.network.orderers),
                `channels.${channel}.orderers`);

            // =================
            // = CHANNEL PEERS =
            // =================
            networkUtil.assertAllNodesExist(Object.keys(channelObj.peers), Object.keys(this.network.peers),
                `channels.${channel}.peers`);

            // ======================
            // = CHANNEL CHAINCODES =
            // ======================
            let chaincodesCollection = channelObj.chaincodes;
            if (chaincodesCollection.size < 1) {
                networkUtil.logAndThrow(`'channels.${channel}.chaincodes' does not contain any elements`);
            }

            // if there are Solidity chaincodes, insert the proxy CC into the list
            if (chaincodesCollection.some(cc => cc.language === 'solidity')) {
                let proxyCC = {
                    id: 'evmcc',
                    contractID: `${channel}.#EVM`,
                    version: 'v0',
                    language: 'golang',
                    path: 'evmcc',
                    gopath: 'src/adapters/fabric-ccp'
                };

                // set its target peers
                if (util.checkProperty(channelObj, 'evmProxyChaincode') &&
                    util.checkProperty(channelObj.evmProxyChaincode, 'targetPeers')) {
                    // targets are explicitly given
                    proxyCC.targetPeers = channelObj.evmProxyChaincode.targetPeers;
                } else {
                    // collect the union of target peers for solidity contracts
                    let solidityTargets = new Set();
                    for (let cc of chaincodesCollection.filter(c => c.language === 'solidity')) {
                        this.getTargetPeersOfChaincodeOfChannel(cc, channel).forEach(t => solidityTargets.add(t));
                    }

                    proxyCC.targetPeers = Array.from(solidityTargets);
                }

                this._addChaincodeToChannelConfig(channel, proxyCC);
                this.evmProxies.set(channel, proxyCC.contractID);
            }

            // to check that there's no duplication
            let chaincodeSet = new Set();

            chaincodesCollection.forEach((cc, index) => {
                // 'metadataPath', 'targetPeers' and 'init' is optional
                let ccObjName = `channels.${channel}.chaincodes[${index}]`;
                util.assertDefined(cc, `The element '${ccObjName}' is undefined or null`);

                // other attributes are optional if the chaincode is already installed and instantiated
                // this will be know at install/instantiate time
                util.assertAllProperties(cc, ccObjName, 'id', 'version');

                let idAndVersion = `${cc.id}@${cc.version}`;
                ccObjName = `channels.${channel}.chaincodes.${idAndVersion}`; // better than an index

                if (chaincodeSet.has(idAndVersion)) {
                    networkUtil.logAndThrow(`${idAndVersion} in ${channel} is defined more than once`);
                }

                chaincodeSet.add(idAndVersion);

                let contractID = util.checkProperty(cc, 'contractID') ? cc.contractID : cc.id;
                if (this.contractMapping.has(contractID)) {
                    networkUtil.logAndThrow(`Contract ID ${contractID} is used more than once`);
                }

                // add the mapping for the contract ID
                this.contractMapping.set(contractID, {channel: channel, id: cc.id, version: cc.version, language: cc.language});

                if (util.checkProperty(cc, 'targetPeers')) {
                    networkUtil.assertAllNodesExist(cc.targetPeers, Object.keys(this.network.peers),
                        `channels.${channel}.chaincodes.${idAndVersion}.targetPeers`);
                }

                ///////////////////
                // EVM CONTRACTS //
                ///////////////////

                // TODO: OBSOLETE
                // if (util.checkProperty(cc, 'evmProxy') && cc.evmProxy) {
                //     this.evmProxies.set(channel, contractID);
                // }

                if (util.checkProperty(cc, 'language') && cc.language === 'solidity') {
                    this.solidityPresent.set(channel, true);

                    // either the path is needed for deployment, or the bytecode with the method signatures,
                    // or the address with the method signatures
                    if (util.checkProperty(cc, 'path')) {
                        util.assertProperty(cc, ccObjName, 'deployerIdentity');

                        if (util.checkProperty(cc, 'bytecode')) {
                            logger.warn(`${contractID}.bytecode will be ignored since a path is provided`);
                        }

                        if (util.checkProperty(cc, 'address')) {
                            logger.warn(`${contractID}.address will be ignored since a path is provided`);
                        }

                        if (util.checkProperty(cc, 'methodSignatures')) {
                            logger.warn(`${contractID}.methodSignatures will be ignored and will be acquired from the compiler since a path is provided`);
                        }
                    } else if (util.checkProperty(cc, 'bytecode')) {
                        util.assertAllProperties(cc, ccObjName, 'deployerIdentity', 'methodSignatures');
                        solidityUtil.checkMethodSignatures(contractID, cc.methodSignatures);

                        if (util.checkProperty(cc, 'address')) {
                            logger.warn(`${contractID}.address will be ignored since bytecode is provided`);
                        }

                        // the bytecode can reside in a file, or embedded in the configuration
                        if (util.checkProperty(cc.bytecode, 'path')) {
                            let resolvedPath = util.resolvePath(cc.bytecode.path);
                            if (!fs.existsSync(resolvedPath)) {
                                throw new Error(`File specified at '${ccObjName}.bytecode.path' does not exist: ${resolvedPath}`);
                            }
                        } else {
                            util.assertProperty(cc.bytecode, ccObjName, 'content');
                        }
                    } else {
                        util.assertAllProperties(cc, ccObjName, 'address', 'methodSignatures');
                        solidityUtil.checkMethodSignatures(contractID, cc.methodSignatures);
                    }
                }

                // if target peers are defined, then check the validity of the references
                if (util.checkProperty(cc, 'targetPeers')) {
                    networkUtil.assertAllNodesExist(cc.targetPeers, Object.keys(this.network.peers),
                        `channels.${channel}.chaincodes[${index}].targetPeers`);
                }
            });
        }

        // =================
        // = ORGANIZATIONS =
        // =================
        let orgs = this.getOrganizations();
        if (orgs.size < 1) {
            networkUtil.logAndThrow('The \'organizations\' section does not contain any entries');
        }

        for (let org of orgs) {
            let orgObj = this.network.organizations[org];
            let orgObjName = `network.organizations.${org}`;

            // Caliper is a special client, it requires admin access to every org
            // NOTE: because of the queries during the init phase, we can't avoid using admin profiles
            // CAs are only needed if a user needs to be enrolled or registered
            util.assertAllProperties(orgObj, orgObjName, 'mspid', 'peers', 'adminPrivateKey', 'signedCert');

            // either path or pem is required
            util.assertAnyProperty(orgObj.adminPrivateKey, `${orgObjName}.adminPrivateKey`, 'path', 'pem');
            util.assertAnyProperty(orgObj.signedCert, `${orgObjName}.signedCert`, 'path', 'pem');

            // normalize paths if provided
            if (util.checkProperty(orgObj.adminPrivateKey, 'path')) {
                orgObj.adminPrivateKey.path = util.resolvePath(orgObj.adminPrivateKey.path);
            }

            if (util.checkProperty(orgObj.signedCert, 'path')) {
                orgObj.signedCert.path = util.resolvePath(orgObj.signedCert.path);
            }

            // ======================
            // = ORGANIZATION PEERS =
            // ======================
            networkUtil.assertAllNodesExist(orgObj.peers, Object.keys(this.network.peers),
                `organizations.${org}.peers`);

            // ===================
            // = ORGANIZATION CA =
            // ===================

            // if CAs are specified, check their validity
            if (util.checkProperty(orgObj, 'certificateAuthorities')) {
                networkUtil.assertAllNodesExist(orgObj.certificateAuthorities, Object.keys(this.network.certificateAuthorities),
                    `organizations.${org}'.certificateAuthorities`);
            }
        }

        // ============
        // = ORDERERS =
        // ============
        let orderers = this.getOrderers();
        if (orderers.size < 1) {
            networkUtil.logAndThrow('The \'orderers\' section does not contain any entries');
        }

        for (let orderer of orderers) {
            // 'grpcOptions' is optional
            util.assertProperty(this.network.orderers, 'network.orderers', orderer);
            let ordererObj = this.network.orderers[orderer];
            let ordererObjName = `network.orderers.${orderer}`;

            util.assertProperty(ordererObj, ordererObjName, 'url');
            // tlsCACerts is needed only for TLS
            if (ordererObj.url.startsWith('grpcs://')) {
                this.tls = true;
                util.assertProperty(ordererObj, ordererObjName, 'tlsCACerts');
                util.assertAnyProperty(ordererObj.tlsCACerts, `${ordererObjName}.tlsCACerts`, 'path', 'pem');

                // normalize path is provided
                if (util.checkProperty(ordererObj.tlsCACerts, 'path')) {
                    ordererObj.tlsCACerts.path = util.resolvePath(ordererObj.tlsCACerts.path);
                }
            }
        }

        // =========
        // = PEERS =
        // =========
        let peers = this.getPeers();
        if (peers.size < 1) {
            networkUtil.logAndThrow('The \'peers\' section does not contain any entries');
        }

        for (let peer of peers) {
            // 'grpcOptions' is optional
            util.assertProperty(this.network.peers, 'network.peers', peer);
            let peerObj = this.network.peers[peer];
            let peerObjName = `network.peers.${peer}`;

            util.assertProperty(peerObj, peerObjName, 'url');

            // tlsCACerts is needed only for TLS
            if (peerObj.url.startsWith('grpcs://')) {
                this.tls = true;
                util.assertProperty(peerObj, peerObjName, 'tlsCACerts');
                util.assertAnyProperty(peerObj.tlsCACerts, `${peerObjName}.tlsCACerts`, 'path', 'pem');

                // normalize path if provided
                if (util.checkProperty(peerObj.tlsCACerts, 'path')) {
                    peerObj.tlsCACerts.path = util.resolvePath(peerObj.tlsCACerts.path);
                }
            }

            if (util.checkProperty(peerObj, 'eventUrl')) {
                this.compatibilityMode = true;

                // check if both URLS are using TLS or neither
                if ((peerObj.url.startsWith('grpcs://') && peerObj.eventUrl.startsWith('grpc://')) ||
                    (peerObj.url.startsWith('grpc://') && peerObj.eventUrl.startsWith('grpcs://'))) {
                    throw new Error(`${peer} uses different protocols for the transaction and event services`);
                }
            }
        }

        // in case of compatibility mode, require event URLs from every peer
        if (this.compatibilityMode) {
            for (let peer of peers) {
                if (!util.checkProperty(this.network.peers[peer], 'eventUrl')) {
                    networkUtil.logAndThrow(`${peer} doesn't provide an event URL in compatibility mode`);
                }
            }
        }

        // ===========================
        // = CERTIFICATE AUTHORITIES =
        // ===========================
        if (util.checkProperty(this.network, 'certificateAuthorities')) {
            let cas = this.getCertificateAuthorities();
            for (let ca of cas) {
                // 'httpOptions' is optional
                util.assertProperty(this.network.certificateAuthorities, 'network.certificateAuthorities', ca);

                let caObj = this.network.certificateAuthorities[ca];
                let caObjName = `network.certificateAuthorities.${ca}`;

                // validate the registrars if provided
                if (util.checkProperty(caObj, 'registrar')) {
                    caObj.registrar.forEach((reg, index) => {
                        util.assertAllProperties(caObj.registrar[index], `${caObjName}.registrar[${index}]`, 'enrollId', 'enrollSecret');
                    });

                    // we actually need the registrar, not just the CA
                    providedCas.add(this.getOrganizationOfCertificateAuthority(ca));
                }

                // tlsCACerts is needed only for TLS
                if (caObj.url.startsWith('https://')) {
                    this.tls = true;
                    util.assertProperty(caObj, caObjName, 'tlsCACerts');
                    util.assertAnyProperty(caObj.tlsCACerts, `${caObjName}.tlsCACerts`, 'path', 'pem');

                    //normalize path if provided
                    if (util.checkProperty(caObj.tlsCACerts, 'path')) {
                        caObj.tlsCACerts.path = util.resolvePath(caObj.tlsCACerts.path);
                    }
                }
            }
        }

        // find the not provided CAs, i.e., requiredCas \ providedCas set operation
        let notProvidedCas = new Set([...requiredCas].filter(ca => !providedCas.has(ca)));
        if (notProvidedCas.size > 0) {
            networkUtil.logAndThrow(`The following org's CAs and their registrars are required for user management, but are not provided: ${Array.from(notProvidedCas).join(', ')}`);
        }

        // ==============================
        // = CHECK CONSISTENT TLS USAGE =
        // ==============================

        // if at least one node has TLS configured
        if (this.tls) {
            // check every orderer
            for (let orderer of orderers) {
                let ordererObj = this.network.orderers[orderer];
                let ordererObjName = `network.orderers.${orderer}`;

                util.assertProperty(ordererObj, ordererObjName, 'tlsCACerts');
                util.assertAnyProperty(ordererObj.tlsCACerts, `${ordererObjName}.tlsCACerts`, 'path', 'pem');

                if (!ordererObj.url.startsWith('grpcs://')) {
                    networkUtil.logAndThrow(`${orderer} doesn't use the grpcs protocol, but TLS is configured on other nodes`);
                }
            }

            // check every peer
            for (let peer of peers) {
                let peerObj = this.network.peers[peer];
                let peerObjName = `network.peers.${peer}`;

                util.assertProperty(peerObj, peerObjName, 'tlsCACerts');
                util.assertAnyProperty(peerObj.tlsCACerts, `${peerObjName}.tlsCACerts`, 'path', 'pem');

                if (!peerObj.url.startsWith('grpcs://')) {
                    networkUtil.logAndThrow(`${peer} doesn't use the grpcs protocol, but TLS is configured on other nodes`);
                }

                // check peer URLs
                if (this.compatibilityMode && !peerObj.eventUrl.startsWith('grpcs://')) {
                    networkUtil.logAndThrow(`${peer} doesn't use the grpcs protocol for eventing, but TLS is configured on other nodes`);
                }
            }

            // check every CA
            if (util.checkProperty(this.network, 'certificateAuthorities')) {
                let cas = this.getCertificateAuthorities();
                for (let ca of cas) {
                    let caObj = this.network.certificateAuthorities[ca];
                    let caObjName = `network.certificateAuthorities.${ca}`;

                    util.assertProperty(caObj, caObjName, 'tlsCACerts');
                    util.assertAnyProperty(caObj.tlsCACerts, `${caObjName}.tlsCACerts`, 'path', 'pem');

                    if (!caObj.url.startsWith('https://')) {
                        networkUtil.logAndThrow(`${ca} doesn't use the https protocol, but TLS is configured on other nodes`);
                    }
                }
            }
        }

        // else: none of the nodes indicated TLS in their configuration/protocol, so nothing to check

        // mutual TLS requires server-side TLS
        if (this.mutualTls && !this.tls) {
            networkUtil.logAndThrow('Mutual TLS is configured without using TLS on network nodes');
        }

        if (this.mutualTls && this.compatibilityMode) {
            networkUtil.logAndThrow('Mutual TLS is not supported for Fabric v1.0');
        }
    }

    //////////////////////
    // PUBLIC FUNCTIONS //
    //////////////////////

    /**
     * Gets the admin crypto materials for the given organization.
     * @param {string} org The name of the organization.
     * @returns {{privateKeyPEM: Buffer, signedCertPEM: Buffer}} The object containing the signing key and cert in PEM format.
     */
    getAdminCryptoContentOfOrganization(org) {
        this._assertOrgExists(org);
        return networkUtil.getAdminCryptoContentOfOrganization(this.network.organizations[org]);
    }

    /**
     * Gets the affiliation of the given client.
     * @param {string} client The client name.
     * @returns {string} The affiliation or 'undefined' if omitted from the configuration.
     */
    getAffiliationOfClient(client) {
        this._assertClientExists(client);
        return networkUtil.getAffiliationOfClient(this.clientConfigs[client].client);
    }

    /**
     * Gets the set of event sources (peer names) in the network.
     * @return {Set<string>} The set of peer names functioning as an event source.
     */
    getAllEventSources() {
        let result = new Set();
        for (let channel of this.getChannels()) {
            for (let peer of this.getPeersOfChannel(channel)) {
                let peerObject = this.network.channels[channel].peers[peer];
                // defaults to true, or explicitly set
                if (!util.checkProperty(peerObject, 'eventSource') || peerObject.eventSource) {
                    result.add(peer);
                }
            }
        }

        if (result.size === 0) {
            throw new Error('Could not find any event source');
        }

        return result;
    }

    /**
     * Gets the registration attributes of the given client.
     * @param {string} client The client name.
     * @returns {{name: string, value: string, ecert: boolean}[]} The attributes or empty array if omitted from the configuration.
     */
    getAttributesOfClient(client) {
        this._assertClientExists(client);
        return networkUtil.getAttributesOfClient(this.clientConfigs[client].client);
    }

    /**
     * Gets the certificate authority names defined in the network configuration.
     *
     * @returns {Set<string>} The set of CA names.
     */
    getCertificateAuthorities() {
        let result = new Set();
        let cas = this.network.certificateAuthorities;
        for (let key in cas) {
            if (!cas.hasOwnProperty(key)) {
                continue;
            }

            result.add(key.toString());
        }

        return result;
    }

    /**
     * Gets the first CA name for the given organization.
     * @param {string} org The organization name.
     * @returns {string} The CA name.
     */
    getCertificateAuthorityOfOrganization(org) {
        this._assertOrgExists(org);
        return networkUtil.getCertificateAuthorityOfOrganization(this.network.organizations[org]);
    }

    /**
     * Gets the chaincode names and versions belonging to the given channel.
     * @param {string} channel The channel name.
     * @returns {Set<{id: string, version: string, language: string}>} The set of chaincode information.
     */
    getChaincodesOfChannel(channel) {
        this._assertChannelExists(channel);
        return networkUtil.getAllChaincodesOfChannel(this.network.channels[channel]);
    }

    /**
     * Gets the channel names defined in the network configuration.
     * @returns {Set<string>} The set of channel names.
     */
    getChannels() {
        let result = new Set();
        let channels = this.network.channels;

        for (let key in channels) {
            if (!channels.hasOwnProperty(key)) {
                continue;
            }

            result.add(key.toString());
        }

        return result;
    }

    /**
     * Gets the array of channels that the peer belongs to.
     * @param {string} peer The name of the peer.
     * @return {string[]} The array of channel names the peer belongs to.
     */
    getChannelsOfPeer(peer) {
        this._assertPeerExists(peer);
        let result = [...this.getChannels()].filter(c => this.getPeersOfChannel(c).has(peer));

        if (result.length === 0) {
            throw new Error(`${peer} does not belong to any channel`);
        }

        return result;
    }

    /**
     * Gets the crypto materials for the given user.
     * @param {string} client The name of the user.
     * @returns {{privateKeyPEM: Buffer, signedCertPEM: Buffer}} The object containing the signing key and cert.
     */
    getClientCryptoContent(client) {
        this._assertClientExists(client);
        return networkUtil.getClientCryptoContent(this.network.clients[client].client);
    }

    /**
     * Gets the enrollment secret of the given client.
     * @param {string} client The client name.
     * @returns {string} The enrollment secret.
     */
    getClientEnrollmentSecret(client) {
        this._assertClientExists(client);
        return networkUtil.getClientEnrollmentSecret(this.network.clients[client].client);
    }

    /**
     * Gets the raw configuration object for the given client.
     *
     * Use it only when you need access to the client objects itself (which is rare)!!
     * @param {string} client The client name.
     * @returns {object} The client object.
     */
    getClientObject(client) {
        this._assertClientExists(client);
        return this.network.clients[client].client;
    }

    /**
     * Gets the clients names defined in the network configuration.
     * @returns {Set<string>} The set of client names.
     */
    getClients() {
        return new Set(Object.keys(this.network.clients));
        // let clients = this.network.clients;
        //
        // for (let key in clients) {
        //     if (!clients.hasOwnProperty(key)) {
        //         continue;
        //     }
        //
        //     result.add(key.toString());
        // }
        //
        // return result;
    }

    /**
     * Gets the client names belonging to the given organization.
     * @param {string} org The organization name.
     * @returns {Set<string>} The set of client names.
     */
    getClientsOfOrganization(org) {
        this._assertOrgExists(org);
        let clients = this.getClients();
        let result = new Set();

        for (let client of clients) {
            if (this.network.clients[client].client.organization === org) {
                result.add(client);
            }
        }

        return result;
    }

    /**
     * Gets the details (channel, id and version) for the given contract.
     * @param {string} contractID The unique ID of the contract.
     * @return {{channel: string, id: string, version: string, language: string}} The details of the contract.
     */
    getContractDetails(contractID) {
        return this.contractMapping.get(contractID);
    }

    /**
     * Gets the contract ID of a chaincode of a given channel.
     * @param {string} channel The name of the channel.
     * @param {string} id The ID of the chaincode.
     * @param {string} version The version of the chaincode.
     * @return {string} The contract ID of the chaincode (which is the normal ID, if a contract ID is not specified).
     */
    getContractIdOfChaincodeOfChannel(channel, id, version) {
        this._assertChannelExists(channel);
        let channelObj = this.network.channels[channel];
        let ccObj = networkUtil.getChaincodeOfChannel(channelObj, id, version);
        return networkUtil.getContractIdOfChaincode(ccObj);
    }

    /**
     * Constructs an N-of-N endorsement policy for the given chaincode of the given channel.
     * @param {string} channel The name of the channel.
     * @param {{id: string, version: string}} chaincodeInfo The chaincode name and version.
     * @return {object} The assembled endorsement policy.
     */
    getDefaultEndorsementPolicy(channel, chaincodeInfo) {
        let targetPeers = this.getTargetPeersOfChaincodeOfChannel(chaincodeInfo, channel);
        let targetOrgs = new Set();

        for (let peer of targetPeers) {
            targetOrgs.add(this.getOrganizationOfPeer(peer));
        }

        return networkUtil.getEndorsementPolicyForOrganizations(Array.from(targetOrgs).sort()
            .map(o => this.getMspIdOfOrganization(o)));
    }

    /**
     * Gets the EVM proxy chaincode for the given channel.
     * @param {string} channel The name of the channel.
     * @return {string} The contract ID of the EVM proxy chaincode, or undefined if not found.
     */
    getEvmProxyChaincodeOfChannel(channel) {
        return this.evmProxies.get(channel);
    }

    /**
     * Gets the first client of the given organization.
     * @param {string} org The name of the organization.
     * @return {string} The name of the client.
     */
    getFirstClientOfOrganization(org) {
        this._assertOrgExists(org);
        let clients = this.getClientsOfOrganization(org);

        if (clients.size < 1) {
            throw new Error(`${org} doesn't have any clients`);
        }

        return Array.from(clients)[0];
    }

    /**
     * Gets the GRPC options of the peer extended with the CA certificate PEM of the peer if present.
     * @param {string} peer The name of the peer.
     * @return {object} An object containing the GRPC options of the peer.
     */
    getGrpcOptionsOfPeer(peer) {
        this._assertPeerExists(peer);
        return networkUtil.getGrpcOptionsOfPeer(this.network.peers[peer]);
    }

    /**
     * Gets the MSP ID of the given organization.
     * @param {string} org The organization name.
     * @returns {string} The MSP ID.
     */
    getMspIdOfOrganization(org) {
        this._assertOrgExists(org);
        return networkUtil.getMspIdOfOrganization(this.network.organizations[org]);
    }

    /**
     * Gets the raw Common Connection Profile object describing the network.
     *
     * Use it only when you need access to the network-related objects itself (which is rare)!!
     * @returns {object} The Common Connection Profile object (with the Caliper extensions).
     */
    getNetworkObject() {
        return this.network;
    }

    /**
     * Gets a new network configuration object instance based on the loaded one.
     * @returns {object} The network configuration object.
     */
    getNewNetworkObject() {
        return yaml.safeLoad(yaml.safeDump(this.network));
    }

    /**
     * Gets the orderer names defined in the network configuration.
     * @returns {Set<string>} The set of orderer names.
     */
    getOrderers() {
        return new Set(Object.keys(this.network.orderers));
    }

    /**
     * Gets the orderer names belonging to the given channel.
     * @param {string} channel The name of the channel.
     * @returns {Set<string>} The set of orderer names.
     */
    getOrderersOfChannel(channel) {
        this._assertChannelExists(channel);
        return networkUtil.getOrderersOfChannel(this.network.channels[channel]);
    }

    /**
     * Gets the organization that the given CA belongs to.
     * @param {string} ca The name of the CA.
     * @return {string} The name of the organization.
     */
    getOrganizationOfCertificateAuthority(ca) {
        this._assertCaExists(ca);
        let orgs = this.getOrganizations();
        for (let org of orgs) {
            if (this.network.organizations[org].certificateAuthorities.includes(ca)) {
                return org;
            }
        }

        networkUtil.logAndThrow(`Couldn't find the owner organization of ${ca}`);
    }

    /**
     * Gets the organization name that the given client belongs to.
     * @param {string} client The client name.
     * @returns {string} The organization name.
     */
    getOrganizationOfClient(client) {
        this._assertClientExists(client);
        return networkUtil.getOrganizationOfClient(this.clientConfigs[client].client);
    }

    /**
     * Gets the organization name in which the given peer belongs to.
     * @param {string} peer The peer name.
     * @returns {string} The organization name.
     */
    getOrganizationOfPeer(peer) {
        this._assertPeerExists(peer);
        let orgs = this.getOrganizations();
        for (let org of orgs) {
            let peers = this.getPeersOfOrganization(org);
            if (peers.has(peer)) {
                return org;
            }
        }

        throw new Error(`Couldn't find the owner organization of ${peer}`);
    }

    /**
     * Gets the organization names defined in the network configuration.
     * @returns {Set<string>} The set of organization names.
     */
    getOrganizations() {
        return new Set(Object.keys(this.network.organizations));
    }

    /**
     * Gets the organization names belonging to the given channel.
     * @param {string} channel The name of the channel.
     * @returns {Set<string>} The set of organization names.
     */
    getOrganizationsOfChannel(channel) {
        this._assertChannelExists(channel);
        let peers = this.getPeersOfChannel(channel);
        let result = new Set();

        for (let peer of peers) {
            result.add(this.getOrganizationOfPeer(peer));
        }

        return result;
    }

    /**
     * Gets the event connection URL of the given peer.
     * @param {string} peer The name of the peer.
     * @return {string} The event URL of the peer.
     */
    getPeerEventUrl(peer) {
        this._assertPeerExists(peer);

        if (!this.isInCompatibilityMode()) {
            networkUtil.logAndThrow('Peer event URLs are only available in Fabric v1.0 compatibility mode');
        }

        return networkUtil.getPeerEventUrl(this.network.peers[peer]);
    }

    /**
     * Gets the name of the peer corresponding to the given address.
     * @param {string} address The address of the peer.
     * @return {string} The name of the peer.
     */
    getPeerNameForAddress(address) {
        for (let peer of this.getPeers()) {
            // remove protocol from address in the config
            let url = networkUtil.getCleanUrlOfPeer(this.network.peers[peer]);
            if (url === address) {
                return peer;
            }
        }

        networkUtil.logAndThrow(`Couldn't find the peer with address of ${address}`);
    }

    /**
     * Gets the peer name corresponding to the given event hub.
     * @param {EventHub|ChannelEventHub} eventHub The event hub instance.
     * @return {string} The name of the peer.
     */
    getPeerNameOfEventHub(eventHub) {
        return this.getPeerNameForAddress(eventHub.getPeerAddr());
    }

    /**
     * Gets the peer names defined in the network configuration.
     *
     * @returns {Set<string>} The set of peer names.
     */
    getPeers() {
        return new Set(Object.keys(this.network.peers));
    }

    /**
     * Gets the peer names belonging to the given channel.
     * @param {string} channel The name of the channel.
     * @returns {Set<string>} The set of peer names.
     */
    getPeersOfChannel(channel) {
        this._assertChannelExists(channel);
        return networkUtil.getPeersOfChannel(this.network.channels[channel]);
    }

    /**
     * Gets the peer names belonging to the given organization.
     * @param {string} org The name of the organization.
     * @returns {Set<string>} The set of peer names.
     */
    getPeersOfOrganization(org) {
        this._assertOrgExists(org);
        return networkUtil.getPeersOfOrganization(this.network.organizations[org]);
    }

    /**
     * Gets the peer names belonging to the given organization AND channel.
     * @param {string} org The name of the organization.
     * @param {string} channel The name of the channel.
     * @returns {Set<string>} The set of peer names.
     */
    getPeersOfOrganizationAndChannel(org, channel) {
        this._assertChannelExists(channel);
        this._assertOrgExists(org);

        let peersInOrg = this.getPeersOfOrganization(org);
        let peersInChannel = this.getPeersOfChannel(channel);

        // return the intersection of the two sets
        return new Set([...peersInOrg].filter(p => peersInChannel.has(p)));
    }

    /**
     * Gets the registrar belonging to the first CA of the given organization.
     * @param {string} org The organization name.
     * @returns {{enrollId: string, enrollSecret: string}} The enrollment ID and secret of the registrar.
     */
    getRegistrarOfOrganization(org) {
        this._assertOrgExists(org);
        let ca = this.getCertificateAuthorityOfOrganization(org);
        return ca ? networkUtil.getRegistrarOfCertificateAuthority(this.network.certificateAuthorities[ca]) : undefined;
    }

    /**
     * Gets the peer names on which chaincodes of the given channel should be installed and instantiated.
     * @param {string} channel The channel name.
     * @returns {Set<string>} The set of peer names.
     */
    getTargetPeersOfChannel(channel) {
        this._assertChannelExists(channel);
        return networkUtil.getTargetPeersOfChannel(this.network.channels[channel]);
    }

    /**
     * Gets the peer names on which the given chaincode of the given channel should be installed and instantiated.
     * @param {{id: string, version: string}} chaincodeInfo The chaincode name and version.
     * @param {string} channel The channel name.
     * @returns {Set<string>} The set of peer names.
     */
    getTargetPeersOfChaincodeOfChannel(chaincodeInfo, channel) {
        this._assertChannelExists(channel);

        let channelObj = this.network.channels[channel];
        let ccObj =channelObj.chaincodes.find(
            cc => cc.id === chaincodeInfo.id && cc.version === chaincodeInfo.version);

        if (!ccObj) {
            networkUtil.logAndThrow(`Could not find ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}'s configuration`);
        }

        return networkUtil.getTargetPeersOfChaincode(ccObj) || this.getTargetPeersOfChannel(channel);
    }

    /**
     * Gets the transient map for the given chaincode for the given channel.
     * @param {{id: string, version: string}} chaincode The chaincode name and version.
     * @param {string} channel The channel name.
     *
     * @return {Map<string, Buffer>} The map of attribute names to byte arrays.
     */
    getTransientMapOfChaincodeOfChannel(chaincode, channel) {
        this._assertChannelExists(channel);

        let channelObj = this.network.channels[channel];
        let chaincodeObj = channelObj.chaincodes.find(
            cc => cc.id === chaincode.id && cc.version === chaincode.version);

        if (!chaincodeObj) {
            networkUtil.logAndThrow(`Couldn't find ${chaincode.id}@${chaincode.version} in ${channel}'s configuration`);
        }

        return networkUtil.getTransientMapOfChaincode(chaincodeObj);
    }

    /**
     * Indicates whether Solidity smart contracts are used in the configuration.
     * @param {string} channel If specified, then the presence of solidity will be checked on the channel-level.
     * @return {boolean} True if Solidity smart contracts are present.
     */
    isSolidityUsed(channel) {
        return channel ? (this.solidityPresent.has(channel) && this.solidityPresent.get(channel))
            : this.solidityPresent.size > 0;
    }

    /**
     * Indicates whether the network is a Fabric v1.0 network or not.
     * @return {boolean} True, if the network contains legacy event service URLs. Otherwise false.
     */
    isInCompatibilityMode() {
        return this.compatibilityMode;
    }

    /**
     * Indicates whether mutual TLS is configured for the adapter.
     * @return {boolean} True, if mutual TLS is configured. Otherwise, false.
     */
    isMutualTlsEnabled() {
        return this.mutualTls;
    }

    /**
     * Indicates whether server-side TLS is configured for the adapter.
     * @return {boolean} True, if server-side TLS is configured. Otherwise, false.
     */
    isTlsEnabled() {
        return this.tls;
    }
}

module.exports = FabricNetwork;