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

const Version = require('../../comm/version.js');
const FabricNetwork = require('./fabricNetwork.js');
const TxStatus = require('../../comm/transaction.js');
const BlockchainInterface = require('../../comm/blockchain-interface.js');

const util = require('../../comm/util.js');
const fabricUtil = require('./fabric-utils.js');
const networkUtil = require('./fabric-network-util.js');
const solidityUtil = require('./fabric-solidity-utils.js');

const fs = require('fs');

const logger = util.getLogger('adapters/fabric-ccp');
const config = require('../../comm/config-util.js').getConfig();

//////////////////////
// TYPE DEFINITIONS //
//////////////////////

/**
 * @typedef {Object} EventSource
 *
 * @property {string[]} channel The list of channels this event source listens on. Only meaningful for Fabric v1.0.
 * @property {string} peer The name of the peer the event source connects to.
 * @property {EventHub|ChannelEventHub} eventHub The event hub object representing the connection.
 */

/**
 * @typedef {Object} ChaincodeInvokeSettings
 *
 * @property {string} chaincodeId Required. The name/ID of the chaincode whose function
 *           should be invoked.
 * @property {string} chaincodeVersion Required. The version of the chaincode whose function
 *           should be invoked.
 * @property {string} chaincodeFunction Required. The name of the function that should be
 *           invoked in the chaincode.
 * @property {string[]} chaincodeArguments Optional. The list of {string} arguments that should
 *           be passed to the chaincode.
 * @property {Map<string, Buffer>} transientMap Optional. The transient map that should be
 *           passed to the chaincode.
 * @property {string} invokerIdentity Required. The name of the client who should invoke the
 *           chaincode. If an admin is needed, use the organization name prefixed with a # symbol.
 * @property {string} channel Required. The name of the channel whose chaincode should be invoked.
 * @property {string[]} targetPeers Optional. An array of endorsing
 *           peer names as the targets of the invoke. When this
 *           parameter is omitted the target list will include the endorsing peers assigned
 *           to the target chaincode, or if it is also omitted, to the channel.
 * @property {string} orderer Optional. The name of the orderer to whom the request should
 *           be submitted. If omitted, then the first orderer node of the channel will be used.
 */

/**
 * @typedef {Object} ChaincodeQuerySettings
 *
 * @property {string} chaincodeId Required. The name/ID of the chaincode whose function
 *           should be invoked.
 * @property {string} chaincodeVersion Required. The version of the chaincode whose function
 *           should be invoked.
 * @property {string} chaincodeFunction Required. The name of the function that should be
 *           invoked in the chaincode.
 * @property {string[]} chaincodeArguments Optional. The list of {string} arguments that should
 *           be passed to the chaincode.
 * @property {Map<string, Buffer>} transientMap Optional. The transient map that should be
 *           passed to the chaincode.
 * @property {string} invokerIdentity Required. The name of the client who should invoke the
 *           chaincode. If an admin is needed, use the organization name prefixed with a # symbol.
 * @property {string} channel Required. The name of the channel whose chaincode should be invoked.
 * @property {string[]} targetPeers Optional. An array of endorsing
 *           peer names as the targets of the invoke. When this
 *           parameter is omitted the target list will include the endorsing peers assigned
 *           to the target chaincode, or if it is also omitted, to the channel.
 * @property {boolean} countAsLoad Optional. Indicates whether to count this query as workload.
 */

/////////////////////////////
// END OF TYPE DEFINITIONS //
/////////////////////////////

/**
 * Implements {BlockchainInterface} for a Fabric backend, utilizing the SDK's Common Connection Profile.
 *
 * @property {Version} version Contains the version information about the used Fabric SDK.
 * @property {Map<string, FabricClient>} clientProfiles Contains the initialized and user-specific SDK client profiles
 *           for each defined user. Maps the custom user names to the Client instances.
 * @property {Map<string, FabricClient>} adminProfiles Contains the initialized and admin-specific SDK client profiles
 *           for each defined admin. Maps the custom organization names to the Client instances
 *           (since only one admin per org is supported).
 * @property {Map<string, FabricClient>} registrarProfiles Contains the initialized and registrar-specific SDK client
 *           profiles for each defined registrar. Maps the custom organization names to the Client instances
 *           (since only one registrar per org is supported).
 * @property {EventSource[]} eventSources Collection of potential event sources to listen to for transaction confirmation events.
 * @property {number} clientIndex The index of the client process using the adapter that is set when calling @link{getContext}.
 * @property {number} txIndex A counter for keeping track of the index of the currently submitted transaction.
 * @property {FabricNetwork} networkUtil Utility object containing easy-to-query information about the topology
 *           and settings of the network.
 * @property {Map<string, Map<string, Map<string, string[]>>>} randomTargetPeerCache Contains the target peers of chaincodes
 *           grouped by channels and organizations: Channel -> Chaincode -> Org -> Peers
 * @property {Map<string, EventSource[]>} channelEventSourcesCache Contains the list of event sources for every channel.
 * @property {Map<string, string[]>} randomTargetOrdererCache Contains the list of target orderers of channels.
 * @property {Map<string, {address: string, abi: string[]}>} evmAbis The ABIs of the deployed EVM smart contracts.
 * @property {Map<string, {user: string, address: string}>} evmUserAddresses The EVM addresses corresponding to each user identity, grouped by channels.
 * @property {Map<string, {certPem: string, keyPem: string}>} dynamicUserMaterials The certs and keys of dynamically enrolled users.
 * @property {string} defaultInvoker The name of the client to use if an invoker is not specified.
 * @property {number} configSmallestTimeout The timeout value to use when the user-provided timeout is too small.
 * @property {number} configSleepAfterCreateChannel The sleep duration in milliseconds after creating the channels.
 * @property {number} configSleepAfterJoinChannel The sleep duration in milliseconds after joining the channels.
 * @property {number} configSleepAfterInstantiateChaincode The sleep duration in milliseconds after instantiating the chaincodes.
 * @property {boolean} configVerifyProposalResponse Indicates whether to verify the proposal responses of the endorsers.
 * @property {boolean} configVerifyReadWriteSets Indicates whether to verify the matching of the returned read-write sets.
 * @property {number} configLatencyThreshold The network latency threshold to use for calculating the final commit time of transactions.
 * @property {boolean} configOverwriteGopath Indicates whether GOPATH should be set to the Caliper root directory.
 * @property {number} configChaincodeInstantiateTimeout The timeout in milliseconds for the chaincode instantiation endorsement.
 * @property {number} configChaincodeInstantiateEventTimeout The timeout in milliseconds for receiving the chaincode instantion event.
 * @property {number} configDefaultTimeout The default timeout in milliseconds to use for invoke/query transactions.
 * @property {string} configClientBasedLoadBalancing The value indicating the type of automatic load balancing to use.
 * @property {boolean} configCountQueryAsLoad Indicates whether queries should be counted as workload.
 */
class Fabric extends BlockchainInterface {
    /**
     * Initializes the Fabric adapter.
     * @param {string|object} networkConfig The relative or absolute file path, or the object itself of the Common Connection Profile settings.
     */
    constructor(networkConfig) {
        super(networkConfig);
        this.version = new Version(require('fabric-client/package').version);

        // NOTE: regardless of the version of the Fabric backend, the SDK must be at least v1.1.0 in order to
        // use the common connection profile feature
        if (this.version.lessThan('1.1.0')) {
            throw new Error(`Fabric SDK ${this.version.toString()} is not supported, use at least version 1.1.0`);
        }

        this.network = new FabricNetwork(networkConfig); // validates the network config
        this.clientProfiles = new Map();
        this.adminProfiles = new Map();
        this.registrarProfiles = new Map();
        this.eventSources = [];
        this.clientIndex = 0;
        this.txIndex = -1;
        this.randomTargetPeerCache = new Map();
        this.channelEventSourcesCache = new Map();
        this.randomTargetOrdererCache = new Map();
        this.evmContractDescriptors = {};
        this.evmUserAddresses = {};
        this.clientMaterialStore = {};
        this.defaultInvoker = Array.from(this.network.getClients())[0];

        // load solidity packages
        if (this.network.isSolidityUsed()) {
            solidityUtil.load();
        }

        if (this.network.isInCompatibilityMode() && this.version.greaterThan('1.1.0')) {
            throw new Error(`Fabric 1.0 compatibility mode is detected, but SDK version ${this.version.toString()} is used`);
        }

        // this value is hardcoded, if it's used, that means that the provided timeouts are not sufficient
        this.configSmallestTimeout = 1000;

        this.configSleepAfterCreateChannel = config.get('fabricCcp:sleepAfter:createChannel', 5000);
        this.configSleepAfterJoinChannel = config.get('fabricCcp:sleepAfter:joinChannel', 3000);
        this.configSleepAfterInstantiateChaincode = config.get('fabricCcp:sleepAfter:instantiateChaincode', 5000);
        this.configVerifyProposalResponse = this._getBoolConfig('fabricCcp:verify:proposalResponse', true);
        this.configVerifyReadWriteSets = this._getBoolConfig('fabricCcp:verify:readWriteSets', true);
        this.configLatencyThreshold = config.get('fabricCcp:latencyThreshold', 1.0);
        this.configOverwriteGopath = this._getBoolConfig('fabricCcp:overwriteGopath', true);
        this.configChaincodeInstantiateTimeout = config.get('fabricCcp:timeout:chaincodeInstantiate', 300000);
        this.configChaincodeInstantiateEventTimeout = config.get('fabricCcp:timeout:chaincodeInstantiateEvent', 300000);
        this.configDefaultTimeout = config.get('fabricCcp:timeout:invokeOrQuery', 60000);
        this.configClientBasedLoadBalancing = config.get('fabricCcp:loadBalancing', 'client') === 'client';
        this.configCountQueryAsLoad = this._getBoolConfig('fabricCcp:countQueryAsLoad', true);

        this._prepareCaches();
    }

    ////////////////////////////////
    // INTERNAL UTILITY FUNCTIONS //
    ////////////////////////////////

    /**
     * Assembles the event sources based on explicitly given target peers.
     * @param {string} channel The name of channel containing the target peers. Doesn't matter if peer-level event service is used in compatibility mode.
     * @param {string[]} targetPeers The list of peers to connect to.
     * @return {EventSource[]} The list of event sources.
     * @private
     */
    _assembleTargetEventSources(channel, targetPeers) {
        let eventSources = [];
        if (this.network.isInCompatibilityMode()) {
            // NOTE: for old event hubs we have a single connection to every peer set as an event source
            const EventHub = require('fabric-client/lib/EventHub.js');

            for (let peer of targetPeers) {
                let org = this.network.getOrganizationOfPeer(peer);
                let admin = this.adminProfiles.get(org);

                let eventHub = new EventHub(admin);
                eventHub.setPeerAddr(this.network.getPeerEventUrl(peer),
                    this.network.getGrpcOptionsOfPeer(peer));

                eventSources.push({
                    channel: [channel], // unused during chaincode instantiation
                    peer: peer,
                    eventHub: eventHub
                });
            }
        } else {
            for (let peer of targetPeers) {
                let org = this.network.getOrganizationOfPeer(peer);
                let admin = this.adminProfiles.get(org);

                let eventHub = admin.getChannel(channel, true).newChannelEventHub(peer);

                eventSources.push({
                    channel: [channel], // unused during chaincode instantiation
                    peer: peer,
                    eventHub: eventHub
                });
            }
        }

        return eventSources;
    }

    /**
     * Assembles random target peers for the channel from every organization that has the chaincode deployed.
     * @param {string} channel The name of the channel.
     * @param {string} chaincodeId The name/ID of the chaincode.
     * @param {string} chaincodeVersion The version of the chaincode.
     * @returns {string[]} Array containing a random peer from each needed organization.
     * @private
     */
    _assembleRandomTargetPeers(channel, chaincodeId, chaincodeVersion) {
        let targets = [];
        let chaincodeOrgs = this.randomTargetPeerCache.get(channel).get(`${chaincodeId}@${chaincodeVersion}`);

        for (let entries of chaincodeOrgs.entries()) {
            let peers = entries[1];

            // represents the load balancing mechanism
            let loadBalancingCounter = this.configClientBasedLoadBalancing ? this.clientIndex : this.txIndex;
            targets.push(peers[loadBalancingCounter % peers.length]);
        }

        return targets;
    }

    /**
     * Creates the specified channels if necessary.
     * @return {boolean} True, if at least one channel was created. Otherwise, false.
     * @private
     * @async
     */
    async _createChannels() {
        let channels = this.network.getChannels();
        let channelCreated = false;

        for (let channel of channels) {
            let channelObject = this.network.getNetworkObject().channels[channel];

            if (util.checkProperty(channelObject, 'created') && channelObject.created) {
                logger.info(`${channel} is configured as created, skipping it`);
                continue;
            }

            channelCreated = true;

            let configUpdate;
            if (util.checkProperty(channelObject, 'configBinary')) {
                configUpdate = networkUtil.getChannelConfigFromFile(channelObject);
            }
            else {
                configUpdate = networkUtil.getChannelConfigFromConfiguration(channelObject);
            }

            // NOTE: without knowing the system channel policies, signing with every org admin is a safe bet
            let orgs = this.network.getOrganizationsOfChannel(channel);
            let admin; // declared here to keep the admin of the last org of the channel
            let signatures = [];
            for (let org of orgs) {
                admin = this.adminProfiles.get(org);
                try {
                    signatures.push(admin.signChannelConfig(configUpdate));
                } catch (err) {
                    throw new Error(`${org}'s admin couldn't sign the configuration update of ${channel}: ${err.message}`);
                }
            }

            let txId = admin.newTransactionID(true);
            let request = {
                config: configUpdate,
                signatures: signatures,
                name: channel,
                txId: txId
            };

            try {
                /** @link{BroadcastResponse} */
                let broadcastResponse = await admin.createChannel(request);

                util.assertDefined(broadcastResponse, `The returned broadcast response for creating ${channel} is undefined`);
                util.assertProperty(broadcastResponse, 'broadcastResponse', 'status');

                if (broadcastResponse.status !== 'SUCCESS') {
                    throw new Error(`Orderer response indicated unsuccessful ${channel} creation: ${broadcastResponse.status}`);
                }
            } catch (err) {
                throw new Error(`Couldn't create ${channel}: ${err.message}`);
            }

            logger.info(`${channel} successfully created`);
        }

        return channelCreated;
    }

    /**
     *
     * @param {EventSource} eventSource The event source to use for registering the Tx event.
     * @param {string} txId The transaction ID.
     * @param {TxStatus} invokeStatus The transaction status object.
     * @param {number} startTime The epoch of the transaction start time.
     * @param {number} timeout The timeout for the transaction life-cycle.
     * @return {Promise<{successful: boolean, message: string, time: number}>} The details of the event notification.
     * @private
     */
    _createEventRegistrationPromise(eventSource, txId, invokeStatus, startTime, timeout) {
        return new Promise(resolve => {
            let handle = setTimeout(() => {
                // give the other event hub connections a chance
                // to verify the Tx status, so resolve the promise

                eventSource.eventHub.unregisterTxEvent(txId);

                let time = Date.now();
                invokeStatus.Set(`commit_timeout_${eventSource.peer}`, 'TIMEOUT');

                // resolve the failed transaction with the current time and error message
                resolve({
                    successful: false,
                    message: `Commit timeout on ${eventSource.peer}`,
                    time: time
                });
            }, fabricUtil.getRemainingTimeout(startTime, timeout, this.configSmallestTimeout));

            eventSource.eventHub.registerTxEvent(txId, (tx, code) => {
                clearTimeout(handle);
                let time = Date.now();
                eventSource.eventHub.unregisterTxEvent(txId);

                // either explicit invalid event or valid event, verified in both cases by at least one peer
                // TODO: what about when a transient error occurred on a peer?
                invokeStatus.SetVerification(true);

                if (code !== 'VALID') {
                    invokeStatus.Set(`commit_error_${eventSource.peer}`, code);

                    resolve({
                        successful: false,
                        message: `Commit error on ${eventSource.peer} with code ${code}`,
                        time: time
                    });
                } else {
                    invokeStatus.Set(`commit_success_${eventSource.peer}`, time);
                    resolve({
                        successful: true,
                        message: 'undefined',
                        time: time
                    });
                }
            }, (err) => {
                clearTimeout(handle);
                eventSource.eventHub.unregisterTxEvent(txId);
                let time = Date.now();

                // we don't know what happened, but give the other event hub connections a chance
                // to verify the Tx status, so resolve this promise
                invokeStatus.Set(`event_hub_error_${eventSource.peer}`, err.message);

                resolve({
                    successful: false,
                    message: `Event hub error on ${eventSource.peer}: ${err.message}`,
                    time: time
                });
            });
        });
    }

    /**
     * Retrieves a bool argument from the configuration store, taking into account the bool parsing behavior.
     * @param {string} key The key of the configuration to retrieve.
     * @param {object} defaultValue The default value to return if the configuration is not found.
     * @return {boolean} The retrieved value of the configuration as true of false. (Instead of 'true' of 'false'.)
     * @private
     */
    _getBoolConfig(key, defaultValue) {
        let val = config.get(key, defaultValue);
        return val === true || val === 'true';
    }

    /**
     * Gets a random target orderer for the given channel.
     * @param {string} channel The name of the channel.
     * @return {string} The name of the target orderer.
     * @private
     */
    _getRandomTargetOrderer(channel) {
        let orderers = this.randomTargetOrdererCache.get(channel);

        // represents the load balancing mechanism
        let loadBalancingCounter = this.configClientBasedLoadBalancing ? this.clientIndex : this.txIndex;

        return orderers[loadBalancingCounter % orderers.length];
    }

    /**
     * Initializes the admins of the organizations.
     *
     * @param {boolean} verbose Indicates whether to log admin init progress.
     * @private
     * @async
     */
    async _initializeAdmins(verbose) {
        let orgs = this.network.getOrganizations();

        for (let org of orgs) {
            await fabricUtil.loadAdminOfOrganization(org, this.network, this.adminProfiles, verbose);
        }
    }

    /**
     * Initializes the registrars of the organizations.
     *
     * @param {boolean} verbose Indicates whether to log the registrar init progress.
     * @private
     * @async
     */
    async _initializeRegistrars(verbose) {
        let orgs = this.network.getOrganizations();

        for (let org of orgs) {
            await fabricUtil.loadRegistrarOfOrganization(org, this.network, this.registrarProfiles, verbose);
        }
    }

    /**
     * Registers and enrolls the specified users if necessary.
     *
     * @param {boolean} verbose Indicates whether to log user init progress.
     * @private
     * @async
     */
    async _initializeUsers(verbose) {
        let clients = this.network.getClients();

        // register and enroll each client with its organization's CA
        for (let client of clients) {
            await fabricUtil.loadUser(client, this.network, this.clientProfiles,
                this.clientMaterialStore, this.registrarProfiles, verbose);
        }
    }

    /**
     * Install the specified chaincodes to their target peers.
     * @private
     * @async
     */
    async _installChaincodes() {
        if (this.configOverwriteGopath) {
            process.env.GOPATH = util.resolvePath('.');
        }

        let errors = [];

        let channels = this.network.getChannels();
        for (let channel of channels) {
            logger.info(`Installing chaincodes for ${channel}...`);

            // proceed cc by cc for the channel
            let chaincodeInfos = this.network.getChaincodesOfChannel(channel);
            for (let chaincodeInfo of chaincodeInfos) {
                // no need to install Solidity contracts
                if (chaincodeInfo.language === 'solidity') {
                    continue;
                }

                let ccObject = this.network.getNetworkObject().channels[channel].chaincodes.find(
                    cc => cc.id === chaincodeInfo.id && cc.version === chaincodeInfo.version);

                let targetPeers = this.network.getTargetPeersOfChaincodeOfChannel(chaincodeInfo, channel);
                if (targetPeers.size < 1) {
                    logger.info(`No target peers are defined for ${chaincodeInfo.id}@${chaincodeInfo.version} on ${channel}, skipping it`);
                    continue;
                }

                // find the peers that don't have the cc installed
                let installTargets = [];

                for (let peer of targetPeers) {
                    let org = this.network.getOrganizationOfPeer(peer);
                    let admin = this.adminProfiles.get(org);

                    try {
                        /** {@link ChaincodeQueryResponse} */
                        let resp = await admin.queryInstalledChaincodes(peer, true);
                        if (resp.chaincodes.some(cc => cc.name === chaincodeInfo.id && cc.version === chaincodeInfo.version)) {
                            logger.info(`${chaincodeInfo.id}@${chaincodeInfo.version} is already installed on ${peer}`);
                            continue;
                        }

                        installTargets.push(peer);
                    } catch (err) {
                        errors.push(new Error(`Couldn't query installed chaincodes on ${peer}: ${err.message}`));
                    }
                }

                if (errors.length > 0) {
                    let errorMsg = `Could not query whether ${chaincodeInfo.id}@${chaincodeInfo.version} is installed on some peers of ${channel}:`;
                    for (let err of errors) {
                        errorMsg += `\n\t- ${err.message}`;
                    }

                    logger.error(errorMsg);
                    throw new Error(`Could not query whether ${chaincodeInfo.id}@${chaincodeInfo.version} is installed on some peers of ${channel}`);
                }

                // cc is installed on every target peer in the channel
                if (installTargets.length < 1) {
                    continue;
                }

                // install chaincodes org by org
                let orgs = this.network.getOrganizationsOfChannel(channel);
                for (let org of orgs) {
                    let peersOfOrg = this.network.getPeersOfOrganization(org);
                    // selecting the target peers for this org
                    let orgPeerTargets = installTargets.filter(p => peersOfOrg.has(p));

                    // cc is installed on every target peer of the org in the channel
                    if (orgPeerTargets.length < 1) {
                        continue;
                    }

                    let admin = this.adminProfiles.get(org);

                    let txId = admin.newTransactionID(true);
                    /** @{ChaincodeInstallRequest} */
                    let request = {
                        targets: orgPeerTargets,
                        chaincodePath: ccObject.language === 'golang' ? ccObject.path : util.resolvePath(ccObject.path),
                        chaincodeId: ccObject.id,
                        chaincodeVersion: ccObject.version,
                        chaincodeType: ccObject.language,
                        txId: txId
                    };

                    // metadata (like CouchDB indices) are only supported since Fabric v1.1
                    if (util.checkProperty(ccObject, 'metadataPath')) {
                        if (!this.network.isInCompatibilityMode()) {
                            request.metadataPath = util.resolvePath(ccObject.metadataPath);
                        } else {
                            throw new Error(`Installing ${chaincodeInfo.id}@${chaincodeInfo.version} with metadata is not supported in Fabric v1.0`);
                        }
                    }

                    // install to necessary peers of org and process the results
                    try {
                        // temporarily change GOPATH if needed
                        let previousGopath = process.env.GOPATH;
                        if (util.checkProperty(ccObject, 'gopath')) {
                            process.env.GOPATH = util.resolvePath(ccObject.gopath);
                        }
                        /** @link{ProposalResponseObject} */
                        let propRespObject = await admin.installChaincode(request);
                        util.assertDefined(propRespObject);

                        // restore gopath
                        process.env.GOPATH = previousGopath;

                        /** Array of @link{ProposalResponse} objects */
                        let proposalResponses = propRespObject[0];
                        util.assertDefined(proposalResponses);

                        proposalResponses.forEach((propResponse, index) => {
                            if (propResponse instanceof Error) {
                                let errMsg = `Install proposal error for ${chaincodeInfo.id}@${chaincodeInfo.version} on ${orgPeerTargets[index]}: ${propResponse.message}`;
                                errors.push(new Error(errMsg));
                                return;
                            }

                            /** @link{ProposalResponse} */
                            util.assertProperty(propResponse, 'propResponse', 'response');

                            /** @link{ResponseObject} */
                            let response = propResponse.response;
                            util.assertProperty(response, 'response', 'status');

                            if (response.status !== 200) {
                                let errMsg = `Unsuccessful install status for ${chaincodeInfo.id}@${chaincodeInfo.version} on ${orgPeerTargets[index]}: ${propResponse.response.message}`;
                                errors.push(new Error(errMsg));
                            }
                        });
                    } catch (err) {
                        throw new Error(`Couldn't install ${chaincodeInfo.id}@${chaincodeInfo.version} on peers ${orgPeerTargets.toString()}: ${err.message}`);
                    }

                    // there were some install errors, proceed to the other orgs to gather more information
                    if (errors.length > 0) {
                        continue;
                    }

                    logger.info(`${chaincodeInfo.id}@${chaincodeInfo.version} successfully installed on ${org}'s peers: ${orgPeerTargets.toString()}`);
                }

                if (errors.length > 0) {
                    let errorMsg = `Could not install ${chaincodeInfo.id}@${chaincodeInfo.version} on some peers of ${channel}:`;
                    for (let err of errors) {
                        errorMsg += `\n\t- ${err.message}`;
                    }

                    logger.error(errorMsg);
                    throw new Error(`Could not install ${chaincodeInfo.id}@${chaincodeInfo.version} on some peers of ${channel}`);
                }
            }
        }
    }

    /**
     * Instantiates the chaincodes on their channels.
     * @return {boolean} True, if at least one chaincode was instantiated. Otherwise, false.
     * @private
     * @async
     */
    async _instantiateChaincodes() {
        let channels = this.network.getChannels();
        let chaincodeInstantiated = false;

        // chaincodes needs to be instantiated channel by channel
        for (let channel of channels) {
            let chaincodeInfos = this.network.getChaincodesOfChannel(channel);

            // instantiate Fabric chaincodes
            for (let chaincodeInfo of chaincodeInfos) {
                // deploy solidity smart contracts after the chaincodes are deployed
                if (chaincodeInfo.language === 'solidity') {
                    continue;
                }

                logger.info(`Instantiating ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}. This might take some time...`);

                let ccObject = this.network.getNetworkObject().channels[channel].chaincodes.find(
                    cc => cc.id === chaincodeInfo.id && cc.version === chaincodeInfo.version);

                let targetPeers = Array.from(this.network.getTargetPeersOfChaincodeOfChannel(chaincodeInfo, channel));
                if (targetPeers.length < 1) {
                    logger.info(`No target peers are defined for ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}, skipping it`);
                    continue;
                }

                // select a target peer for the chaincode to see if it's instantiated
                // these are the same as the install targets, so if one of the peers has already instantiated the chaincode,
                // then the other targets also had done the same
                let org = this.network.getOrganizationOfPeer(targetPeers[0]);
                let admin = this.adminProfiles.get(org);

                /** @link{ChaincodeQueryResponse} */
                let queryResponse;
                try {
                    queryResponse = await admin.getChannel(channel, true).queryInstantiatedChaincodes(targetPeers[0], true);
                } catch (err) {
                    throw new Error(`Couldn't query whether ${chaincodeInfo.id}@${chaincodeInfo.version} is instantiated on ${targetPeers[0]}: ${err.message}`);
                }

                util.assertDefined(queryResponse);
                util.assertProperty(queryResponse, 'queryResponse', 'chaincodes');

                if (queryResponse.chaincodes.some(
                    cc => cc.name === chaincodeInfo.id && cc.version === chaincodeInfo.version)) {
                    logger.info(`${chaincodeInfo.id}@${chaincodeInfo.version} is already instantiated in ${channel}`);
                    continue;
                }

                chaincodeInstantiated = true;

                let txId = admin.newTransactionID(true);
                /** @link{ChaincodeInstantiateUpgradeRequest} */
                let request = {
                    targets: targetPeers,
                    chaincodeId: ccObject.id,
                    chaincodeVersion: ccObject.version,
                    chaincodeType: ccObject.language,
                    args: ccObject.init || [],
                    fcn: ccObject.function || 'init',
                    'endorsement-policy': ccObject['endorsement-policy'] ||
                        this.network.getDefaultEndorsementPolicy(channel, { id: ccObject.id, version: ccObject.version }),
                    transientMap: this.network.getTransientMapOfChaincodeOfChannel(chaincodeInfo, channel),
                    txId: txId
                };

                // check chaincode language
                // other chaincodes types are not supported in every version
                if (ccObject.language !== 'golang') {
                    if (ccObject.language === 'node' && this.network.isInCompatibilityMode()) {
                        throw new Error(`${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: Node.js chaincodes are supported starting from Fabric v1.1`);
                    }

                    if (ccObject.language === 'java' && this.version.lessThan('1.3.0')) {
                        throw new Error(`${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: Java chaincodes are supported starting from Fabric v1.3`);
                    }

                    if (!['golang', 'node', 'java'].includes(ccObject.language)) {
                        throw new Error(`${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: unknown chaincode type ${ccObject.language}`);
                    }
                }

                // check private collection configuration
                if (util.checkProperty(ccObject, 'collections-config')) {
                    if (this.version.lessThan('1.2.0')) {
                        throw new Error(`${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: private collections are supported from Fabric v1.2`);
                    }

                    request['collections-config'] = ccObject['collections-config'];
                }

                /** @link{ProposalResponseObject} */
                let response;
                try {
                    response = await admin.getChannel(channel, true).sendInstantiateProposal(request, this.configChaincodeInstantiateTimeout);
                } catch (err) {
                    throw new Error(`Couldn't endorse ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel} on peers [${targetPeers.toString()}]: ${err.message}`);
                }

                util.assertDefined(response);

                /** @link{Array<ProposalResponse>} */
                let proposalResponses = response[0];
                /** @link{Proposal} */
                let proposal = response[1];
                util.assertDefined(proposalResponses);
                util.assertDefined(proposal);

                // check each response
                proposalResponses.forEach((propResp, index) => {
                    util.assertDefined(propResp);
                    // an Error is returned for a rejected proposal
                    if (propResp instanceof Error) {
                        throw new Error(`Invalid endorsement for ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel} from ${targetPeers[index]}: ${propResp.message}`);
                    } else if (propResp.response.status !== 200) {
                        throw new Error(`Invalid endorsement for ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel} from ${targetPeers[index]}: status code ${propResp.response.status}`);
                    }
                });

                // connect to every event source of every org in the channel
                let eventSources = this._assembleTargetEventSources(channel, targetPeers);
                let eventPromises = [];

                try {
                    // NOTE: everything is resolved, errors are signaled through an Error object
                    // this makes error handling and reporting easier
                    eventSources.forEach((es) => {
                        let promise = new Promise((resolve) => {
                            let timeoutHandle = setTimeout(() => {
                                // unregister manually
                                es.eventHub.unregisterTxEvent(txId.getTransactionID(), false);
                                resolve(new Error(`Commit timeout for ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel} from ${es.peer}`));
                            }, this.configChaincodeInstantiateEventTimeout);

                            es.eventHub.registerTxEvent(txId.getTransactionID(), (tx, code) => {
                                clearTimeout(timeoutHandle);
                                if (code !== 'VALID') {
                                    resolve(new Error(`Invalid commit code for ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel} from ${es.peer}: ${code}`));
                                } else {
                                    resolve(code);
                                }
                            }, /* Error handler */ (err) => {
                                clearTimeout(timeoutHandle);
                                resolve(new Error(`Event hub error from ${es.peer} during instantiating ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: ${err.message}`));
                            });

                            es.eventHub.connect();
                        });

                        eventPromises.push(promise);
                    });

                    /** @link{TransactionRequest} */
                    let ordererRequest = {
                        txId: txId,
                        proposalResponses: proposalResponses,
                        proposal: proposal
                    };

                    /** @link{BroadcastResponse} */
                    let broadcastResponse;
                    try {
                        broadcastResponse = await admin.getChannel(channel, true).sendTransaction(ordererRequest);
                    } catch (err) {
                        throw new Error(`Orderer error for instantiating ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: ${err.message}`);
                    }

                    util.assertDefined(broadcastResponse);
                    util.assertProperty(broadcastResponse, 'broadcastResponse', 'status');

                    if (broadcastResponse.status !== 'SUCCESS') {
                        throw new Error(`Orderer error for instantiating ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}: ${broadcastResponse.status}`);
                    }

                    // since every event promise is resolved, this shouldn't throw an error
                    let eventResults = await Promise.all(eventPromises);

                    // if we received an error, propagate it
                    if (eventResults.some(er => er instanceof Error)) {
                        let errMsg = `The following errors occured while instantiating ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}:`;
                        let err; // keep the last error
                        for (let eventResult of eventResults) {
                            if (eventResult instanceof Error) {
                                err = eventResult;
                                errMsg += `\n\t- ${eventResult.message}`;
                            }
                        }

                        logger.error(errMsg);
                        throw err;
                    }

                    logger.info(`Successfully instantiated ${chaincodeInfo.id}@${chaincodeInfo.version} in ${channel}`);
                } finally {
                    eventSources.forEach(es => {
                        if (es.eventHub.isconnected()) {
                            es.eventHub.disconnect();
                        }
                    });
                }
            }

            // map the network client identities to EVM addresses if EVM contracts are present
            if (!this.network.isSolidityUsed()) {
                continue;
            }

            let context = await this.getContext(undefined, undefined, 0);
            await util.sleep(1000);

            // deploy Solidity contracts
            for (let chaincodeInfo of chaincodeInfos) {
                if (chaincodeInfo.language !== 'solidity') {
                    continue;
                }

                let ccObject = this.network.getNetworkObject().channels[channel].chaincodes.find(
                    cc => cc.id === chaincodeInfo.id && cc.version === chaincodeInfo.version && cc.language === chaincodeInfo.language);

                let contractID = this.network.getContractIdOfChaincodeOfChannel(channel, chaincodeInfo.id, chaincodeInfo.version);
                let contractDescriptor;

                let bytecode;
                let contractName = util.checkProperty(ccObject, 'contractName') ? ccObject.contractName : ccObject.id;

                // priority: path > bytecode > address
                if (util.checkProperty(ccObject, 'path')) {
                    // need to compile
                    let contractPath = util.resolvePath(ccObject.path);
                    let compilerResult = await solidityUtil.compileContract(contractPath, contractName,
                        util.checkProperty(ccObject, 'detectCompilerVersion') && ccObject.detectCompilerVersion);

                    bytecode = compilerResult.bytecode;
                    // save the signatures for the client processes, still need the address
                    contractDescriptor = { methodSignatures: compilerResult.methodSignatures };
                } else if (util.checkProperty(ccObject, 'bytecode')) {
                    // if the bytecode is provided, no need for compilation
                    logger.info(`${contractID} bytecode provided, skipping compilation`);
                    if (util.checkProperty(ccObject.bytecode, 'path')) {
                        bytecode = fs.readFileSync(util.resolvePath(ccObject.bytecode.path), 'utf-8').toString();
                    } else {
                        bytecode = ccObject.bytecode.content;
                    }

                    // save the signatures for the client processes, still need the address
                    contractDescriptor = { methodSignatures: solidityUtil.parseMethodSignatures(ccObject.methodSignatures) };
                } else {
                    logger.info(`${contractID} is already deployed in ${channel} at address ${ccObject.address}`);

                    // save the descriptor for distribution for the client processes
                    contractDescriptor = {
                        address: ccObject.address,
                        methodSignatures: solidityUtil.parseMethodSignatures(ccObject.methodSignatures)
                    };
                    this.evmContractDescriptors[contractID] = contractDescriptor;
                    continue;
                }

                let ctrArgsProvided = util.checkProperty(ccObject, 'init');
                let hasConstructor = solidityUtil.isConstructorArgsNeeded(contractDescriptor.methodSignatures);

                if (ctrArgsProvided && !hasConstructor) {
                    throw new Error(`Solidity contract ${contractID} does not contain a constructor, but arguments are provided`);
                }

                if (!ctrArgsProvided && hasConstructor) {
                    throw new Error(`Solidity contract ${contractID} contains a constructor, but no arguments are provided`);
                }

                // check for constructor arguments, and append their encodings
                if (ctrArgsProvided) {
                    bytecode += solidityUtil.encodeConstructorArguments(contractDescriptor.methodSignatures, ccObject.init);
                    logger.debug(`${contractID} bytecode with constructor arguments: ${bytecode}`);
                }

                // deploy the contract through the EVM proxy chaincode of the channel
                let zeroAddress = solidityUtil.getZeroAddress();
                let evmProxyChaincodeID = this.network.getEvmProxyChaincodeOfChannel(channel);
                let evmProxyChaincodeDetails = this.network.getContractDetails(evmProxyChaincodeID);

                let invokeSettings = {
                    invokerIdentity: ccObject.deployerIdentity,
                    channel: evmProxyChaincodeDetails.channel,
                    chaincodeId: evmProxyChaincodeDetails.id,
                    chaincodeVersion: evmProxyChaincodeDetails.version,
                    chaincodeFunction: zeroAddress,
                    chaincodeArguments: [ bytecode, '0', contractName ] // zero wei, plus contractName will be the nonce
                };

                // setup eventhubs for a transaction invocation
                logger.info(`Deploying Solidity contract ${contractID}. This might take some time...`);
                let results = await this._submitSingleTransaction(context, invokeSettings, 100*1000);

                if (!results.IsCommitted()) {
                    throw new Error(`Couldn't deploy Solidity contract ${contractID}`);
                }

                contractDescriptor.address = results.GetResult().toString();
                // save the descriptor for the client processes
                this.evmContractDescriptors[contractID] = contractDescriptor;
                logger.info(`Successfully deployed Solidity contract ${contractID}`);
            }

            let evmProxyChaincodeID = this.network.getEvmProxyChaincodeOfChannel(channel);
            let evmProxyChaincodeDetails = this.network.getContractDetails(evmProxyChaincodeID);

            let querySettings = {
                channel: evmProxyChaincodeDetails.channel,
                chaincodeId: evmProxyChaincodeDetails.id,
                chaincodeVersion: evmProxyChaincodeDetails.version,
                chaincodeFunction: 'account', // get the account address for the invoker
                countAsLoad: false
            };

            for (let client of this.clientProfiles) {
                querySettings.invokerIdentity = client[0];
                let result = await this._submitSingleQuery(context, querySettings, 10 * 1000);
                if (!result.IsCommitted()) {
                    throw new Error(`Failed to get EVM address for ${client[0]}`);
                }

                if (!this.evmUserAddresses[channel]) {
                    this.evmUserAddresses[channel] = {};
                }

                // save the user address on a per channel basis
                // (just in case other EVM proxy implementations are used in other channels)
                let userAddress = `0x${result.GetResult().toString()}`;
                logger.debug(`EVM user address for ${client[0]} in ${channel}: ${userAddress}`);
                this.evmUserAddresses[channel][client[0]] = userAddress;
            }

            for (let admin of this.adminProfiles) {
                querySettings.invokerIdentity = `#${admin[0]}`;
                let result = await this._submitSingleQuery(undefined, querySettings, 10 * 1000);
                if (!result.IsCommitted()) {
                    throw new Error(`Failed to get EVM address for ${admin[0]}`);
                }

                if (!this.evmUserAddresses[channel]) {
                    this.evmUserAddresses[channel] = {};
                }

                // save the user address on a per channel basis
                // (just in case other EVM proxy implementations are used in other channels)
                let userAddress = `0x${result.GetResult().toString()}`;
                logger.debug(`EVM user address for ${admin[0]} in ${channel}: ${userAddress}`);
                this.evmUserAddresses[channel][`#${admin[0]}`] = userAddress;
            }

            // set initial balances
            let txSettings = {
                channel: evmProxyChaincodeDetails.channel,
                chaincodeId: evmProxyChaincodeDetails.id,
                chaincodeVersion: evmProxyChaincodeDetails.version,
                chaincodeFunction: 'addToBalance',
                chaincodeArguments: [ '100000' ]
            };

            for (let client of this.clientProfiles) {
                txSettings.invokerIdentity = client[0];
                logger.debug(`Initializing balance for ${client[0]}...`);
                let result = await this._submitSingleTransaction(context, txSettings, 10 * 1000);
                if (!result.IsCommitted()) {
                    throw new Error(`Failed to set initial balance for ${client[0]}`);
                }
            }

            for (let admin of this.adminProfiles) {
                txSettings.invokerIdentity = `#${admin[0]}`;
                let result = await this._submitSingleTransaction(context, txSettings, 10 * 1000);
                if (!result.IsCommitted()) {
                    throw new Error(`Failed to set initial balance for ${admin[0]}`);
                }
            }

            await this.releaseContext(context);
        }

        return chaincodeInstantiated;
    }

    /**
     * Joins the peers to the specified channels is necessary.
     * @return {boolean} True, if at least one peer joined a channel. Otherwise, false.
     * @private
     * @async
     */
    async _joinChannels() {
        let channels = this.network.getChannels();
        let channelJoined = false;
        let errors = [];

        for (let channelName of channels) {
            let genesisBlock = null;
            let orgs = this.network.getOrganizationsOfChannel(channelName);

            for (let org of orgs) {
                let admin = this.adminProfiles.get(org);
                let channelObject = admin.getChannel(channelName, true);

                let peers = this.network.getPeersOfOrganizationAndChannel(org, channelName);
                let peersToJoin = [];

                for (let peer of peers) {
                    try {
                        /** {@link ChannelQueryResponse} */
                        let resp = await admin.queryChannels(peer, true);
                        if (resp.channels.some(ch => ch.channel_id === channelName)) {
                            logger.info(`${peer} has already joined ${channelName}`);
                            continue;
                        }

                        peersToJoin.push(peer);
                    } catch (err) {
                        errors.push(new Error(`Couldn't query ${channelName} information from ${peer}: ${err.message}`));
                    }
                }

                if (errors.length > 0) {
                    let errMsg = `The following errors occurred while querying ${channelName} information from ${org}'s peers:`;
                    for (let err of errors) {
                        errMsg += `\n\t- ${err.message}`;
                    }

                    logger.error(errMsg);
                    throw new Error(`Couldn't query ${channelName} information from ${org}'s peers`);
                }

                // all target peers of the org have already joined the channel
                if (peersToJoin.length < 1) {
                    continue;
                }

                channelJoined = true;

                // only retrieve the genesis block once, and "cache" it
                if (genesisBlock === null) {
                    try {
                        let genesisTxId = admin.newTransactionID(true);
                        /** @link{OrdererRequest} */
                        let genesisRequest = {
                            txId: genesisTxId
                        };
                        genesisBlock = await channelObject.getGenesisBlock(genesisRequest);
                    } catch (err) {
                        throw new Error(`Couldn't retrieve the genesis block for ${channelName}: ${err.message}`);
                    }
                }

                let joinTxId = admin.newTransactionID(true);
                let joinRequest = {
                    block: genesisBlock,
                    txId: joinTxId,
                    targets: peersToJoin
                };

                try {
                    /**{@link ProposalResponse} array*/
                    let joinRespArray = await channelObject.joinChannel(joinRequest);
                    util.assertDefined(joinRespArray);

                    // Some errors are returned as Error instances, some as error messages
                    joinRespArray.forEach((propResponse, index) => {
                        if (propResponse instanceof Error) {
                            errors.push(new Error(`${peersToJoin[index]} could not join ${channelName}: ${propResponse.message}`));
                        } else if (propResponse.response.status !== 200) {
                            errors.push(new Error(`${peersToJoin[index]} could not join ${channelName}: ${propResponse.response.message}`));
                        }
                    });
                } catch (err) {
                    new Error(`Couldn't join peers ${peersToJoin.toString()} to ${channelName}: ${err.message}`);
                }

                if (errors.length > 0) {
                    let errMsg = `The following errors occurred while ${org}'s peers tried to join ${channelName}:`;
                    for (let err of errors) {
                        errMsg += `\n\t- ${err.message}`;
                    }

                    logger.error(errMsg);
                    throw new Error(`${org}'s peers couldn't join ${channelName}`);
                }

                logger.info(`${org}'s peers successfully joined ${channelName}: ${peersToJoin}`);
            }
        }

        return channelJoined;
    }

    /**
     * Prepares caches (pre-calculated values) used during transaction invokes.
     * @private
     */
    _prepareCaches() {
        // assemble random target peer cache for each channel's each chaincode
        for (let channel of this.network.getChannels()) {
            this.randomTargetPeerCache.set(channel, new Map());

            for (let chaincode of this.network.getChaincodesOfChannel(channel)) {
                let idAndVersion = `${chaincode.id}@${chaincode.version}`;
                this.randomTargetPeerCache.get(channel).set(idAndVersion, new Map());

                let targetOrgs = new Set();
                let targetPeers = this.network.getTargetPeersOfChaincodeOfChannel(chaincode, channel);

                // get target orgs
                for (let peer of targetPeers) {
                    targetOrgs.add(this.network.getOrganizationOfPeer(peer));
                }

                // set target peers in each org
                for (let org of targetOrgs) {
                    let peersOfOrg = this.network.getPeersOfOrganizationAndChannel(org, channel);

                    // the peers of the org that target the given chaincode of the given channel
                    // one of these peers needs to be a target for every org
                    // NOTE: this assumes an n-of-n endorsement policy, which is a safe default
                    this.randomTargetPeerCache.get(channel).get(idAndVersion).set(org, [...peersOfOrg].filter(p => targetPeers.has(p)));
                }
            }
        }

        // assemble random target orderer cache for each channel
        for (let channel of this.network.getChannels()) {
            this.randomTargetOrdererCache.set(channel, Array.from(this.network.getOrderersOfChannel(channel)));
        }
    }

    /**
     * Queries the specified chaincode according to the provided settings.
     *
     * @param {object} context The context previously created by the Fabric adapter.
     * @param {ChaincodeQuerySettings} querySettings The settings associated with the query.
     * @param {number} timeout The timeout for the call in milliseconds.
     * @return {Promise<TxStatus>} The result and stats of the transaction query.
     */
    async _submitSingleQuery(context, querySettings, timeout) {
        let startTime = Date.now();
        this.txIndex++;

        let countAsLoad = querySettings.countAsLoad === undefined ? this.configCountQueryAsLoad : querySettings.countAsLoad;

        // retrieve the necessary client/admin profile
        let invoker;
        let admin = false;

        if (querySettings.invokerIdentity.startsWith('#')) {
            invoker = this.adminProfiles.get(querySettings.invokerIdentity.substring(1));
            admin = true;
        } else {
            invoker = this.clientProfiles.get(querySettings.invokerIdentity);
        }

        // this hints at an error originating from the outside, so it should terminate
        if (!invoker) {
            throw Error(`Invoker ${querySettings.invokerIdentity} not found!`);
        }

        const txIdObject = invoker.newTransactionID(admin);
        const txId = txIdObject.getTransactionID();

        let invokeStatus = new TxStatus(txId);
        invokeStatus.Set('request_type', 'query');
        invokeStatus.SetVerification(true); // querying is a one-step process unlike a normal transaction, so the result is always verified

        ////////////////////////////////
        // SEND TRANSACTION PROPOSALS //
        ////////////////////////////////

        let targetPeers = querySettings.targetPeers ||
            this._assembleRandomTargetPeers(querySettings.channel, querySettings.chaincodeId, querySettings.chaincodeVersion);

        /** @link{ChaincodeInvokeRequest} */
        const proposalRequest = {
            chaincodeId: querySettings.chaincodeId,
            fcn: querySettings.chaincodeFunction,
            args: querySettings.chaincodeArguments || [],
            transientMap: querySettings.transientMap,
            targets: targetPeers,
            txId: txIdObject
        };

        // the exception should propagate up for an invalid channel name, indicating a user callback module error
        let channel = invoker.getChannel(querySettings.channel, true);


        if (countAsLoad && context && context.engine) {
            context.engine.submitCallback(1);
        }

        /** Array of {Buffer|Error} */
        let results = null;

        // NOTE: everything happens inside a try-catch
        // no exception should escape, query failures have to be handled gracefully
        try {
            // NOTE: wrap it in a Promise to enforce user-provided timeout
            let resultPromise = new Promise(async (resolve, reject) => {
                let timeoutHandle = setTimeout(() => {
                    reject(new Error('TIMEOUT'));
                }, fabricUtil.getRemainingTimeout(startTime, timeout, this.configSmallestTimeout));

                let result = await channel.queryByChaincode(proposalRequest, admin);
                clearTimeout(timeoutHandle);
                resolve(result);
            });

            results = await resultPromise;

            ///////////////////////
            // CHECK THE RESULTS //
            ///////////////////////

            let errMsg;

            // filter for errors inside, so we have accurate indices for the corresponding peers
            results.forEach((value, index) => {
                let targetName = targetPeers[index];
                if (value instanceof Error) {
                    invokeStatus.Set(`endorsement_result_error_${targetName}`, value.message);
                    errMsg = `\n\t- Endorsement error from ${targetName}: ${value.message}`;
                } else {
                    // NOTE: the last result will be kept
                    invokeStatus.SetResult(value);
                    invokeStatus.Set(`endorsement_result_${targetName}`, value);
                }
            });

            if (errMsg) {
                invokeStatus.SetStatusFail();
                logger.error(`Query error for ${querySettings.chaincodeId}@${querySettings.chaincodeVersion} in ${querySettings.channel}:${errMsg}`);
            } else {
                invokeStatus.SetStatusSuccess();
            }
        } catch (err) {
            invokeStatus.SetStatusFail();
            invokeStatus.Set('unexpected_error', err.message);
            logger.error(`Unexpected query error for ${querySettings.chaincodeId}@${querySettings.chaincodeVersion} in ${querySettings.channel}: ${err.stack ? err.stack : err}`);
        }

        return invokeStatus;
    }

    /**
     * Invokes the specified chaincode according to the provided settings.
     *
     * @param {object} context The context previously created by the Fabric adapter.
     * @param {ChaincodeInvokeSettings} invokeSettings The settings associated with the transaction submission.
     * @param {number} timeout The timeout for the whole transaction life-cycle in milliseconds.
     * @return {Promise<TxStatus>} The result and stats of the transaction invocation.
     */
    async _submitSingleTransaction(context, invokeSettings, timeout) {
        // note start time to adjust the timeout parameter later
        const startTime = Date.now();
        this.txIndex++; // increase the counter

        // NOTE: since this function is a hot path, there aren't any assertions for the sake of efficiency

        // retrieve the necessary client/admin profile
        let invoker;
        let admin = false;

        if (invokeSettings.invokerIdentity.startsWith('#')) {
            invoker = this.adminProfiles.get(invokeSettings.invokerIdentity.substring(1));
            admin = true;
        } else {
            invoker = this.clientProfiles.get(invokeSettings.invokerIdentity);
        }

        // this hints at an error originating from the outside, so it should terminate
        if (!invoker) {
            throw Error(`Invoker ${invokeSettings.invokerIdentity} not found!`);
        }

        ////////////////////////////////
        // PREPARE SOME BASIC OBJECTS //
        ////////////////////////////////

        const txIdObject = invoker.newTransactionID(admin);
        const txId = txIdObject.getTransactionID();

        // timestamps are recorded for every phase regardless of success/failure
        let invokeStatus = new TxStatus(txId);
        invokeStatus.Set('request_type', 'transaction');

        let errors = []; // errors are collected during response validations

        ////////////////////////////////
        // SEND TRANSACTION PROPOSALS //
        ////////////////////////////////

        let targetPeers = invokeSettings.targetPeers ||
            this._assembleRandomTargetPeers(invokeSettings.channel, invokeSettings.chaincodeId, invokeSettings.chaincodeVersion);

        /** @link{ChaincodeInvokeRequest} */
        const proposalRequest = {
            chaincodeId: invokeSettings.chaincodeId,
            fcn: invokeSettings.chaincodeFunction,
            args: invokeSettings.chaincodeArguments || [],
            txId: txIdObject,
            transientMap: invokeSettings.transientMap,
            targets: targetPeers
        };

        let channel = invoker.getChannel(invokeSettings.channel, true);

        /** @link{ProposalResponseObject} */
        let proposalResponseObject = null;

        // NOTE: everything happens inside a try-catch
        // no exception should escape, transaction failures have to be handled gracefully
        try {
            if (context && context.engine) {
                context.engine.submitCallback(1);
            }
            try {
                // account for the elapsed time up to this point
                proposalResponseObject = await channel.sendTransactionProposal(proposalRequest,
                    fabricUtil.getRemainingTimeout(startTime, timeout, this.configSmallestTimeout));

                invokeStatus.Set('time_endorse', Date.now());
            } catch (err) {
                invokeStatus.Set('time_endorse', Date.now());
                invokeStatus.Set('proposal_error', err.message);

                // error occurred, early life-cycle termination, definitely failed
                invokeStatus.SetVerification(true);

                errors.push(err);
                throw errors; // handle every logging in one place at the end
            }

            //////////////////////////////////
            // CHECKING ENDORSEMENT RESULTS //
            //////////////////////////////////

            /** @link{Array<ProposalResponse>} */
            const proposalResponses = proposalResponseObject[0];
            /** @link{Proposal} */
            const proposal = proposalResponseObject[1];

            // NOTES: filter inside, so we have accurate indices corresponding to the original target peers
            proposalResponses.forEach((value, index) => {
                let targetName = targetPeers[index];

                // Errors from peers/chaincode are returned as an Error object
                if (value instanceof Error) {
                    invokeStatus.Set(`proposal_response_error_${targetName}`, value.message);

                    // explicit rejection, early life-cycle termination, definitely failed
                    invokeStatus.SetVerification(true);
                    errors.push(new Error(`Proposal response error by ${targetName}: ${value.message}`));
                    return;
                }

                /** @link{ProposalResponse} */
                let proposalResponse = value;

                // save a chaincode results/response
                // NOTE: the last one will be kept as result
                invokeStatus.SetResult(proposalResponse.response.payload);
                invokeStatus.Set(`endorsement_result_${targetName}`, proposalResponse.response.payload);
                invokeStatus.Set('rwset_payload', proposalResponse.payload); // the last will prevail

                // verify the endorsement signature and identity if configured
                if (this.configVerifyProposalResponse) {
                    if (!channel.verifyProposalResponse(proposalResponse)) {
                        invokeStatus.Set(`endorsement_verify_error_${targetName}`, 'INVALID');

                        // explicit rejection, early life-cycle termination, definitely failed
                        invokeStatus.SetVerification(true);
                        errors.push(new Error(`Couldn't verify endorsement signature or identity of ${targetName}`));
                        return;
                    }
                }

                /** @link{ResponseObject} */
                let responseObject = proposalResponse.response;

                if (responseObject.status !== 200) {
                    invokeStatus.Set(`endorsement_result_error_${targetName}`, `${responseObject.status} ${responseObject.message}`);

                    // explicit rejection, early life-cycle termination, definitely failed
                    invokeStatus.SetVerification(true);
                    errors.push(new Error(`Endorsement denied by ${targetName}: ${responseObject.message}`));
                }
            });

            // if there were errors, stop further processing, jump to the end
            if (errors.length > 0) {
                throw errors;
            }

            if (this.configVerifyReadWriteSets) {
                // check all the read/write sets to see if they're the same
                if (!channel.compareProposalResponseResults(proposalResponses)) {
                    invokeStatus.Set('read_write_set_error', 'MISMATCH');

                    // r/w set mismatch, early life-cycle termination, definitely failed
                    invokeStatus.SetVerification(true);
                    errors.push(new Error('Read/Write set mismatch between endorsements'));
                    throw errors;
                }
            }

            /////////////////////////////////
            // REGISTERING EVENT LISTENERS //
            /////////////////////////////////

            let eventPromises = []; // to wait for every event response

            // NOTE: in compatibility mode, the same EventHub can be used for multiple channels
            // if the peer is part of multiple channels
            this.channelEventSourcesCache.get(invokeSettings.channel).forEach((eventSource) => {
                eventPromises.push(this._createEventRegistrationPromise(eventSource,
                    txId, invokeStatus, startTime, timeout));
            });

            ///////////////////////////////////////////
            // SUBMITTING TRANSACTION TO THE ORDERER //
            ///////////////////////////////////////////

            let targetOrderer = invokeSettings.orderer || this._getRandomTargetOrderer(invokeSettings.channel);

            /** @link{TransactionRequest} */
            const transactionRequest = {
                proposalResponses: proposalResponses,
                proposal: proposal,
                orderer: targetOrderer
            };

            /** @link{BroadcastResponse} */
            let broadcastResponse;
            try {
                // wrap it in a Promise to add explicit timeout to the call
                let responsePromise = new Promise(async (resolve, reject) => {
                    let timeoutHandle = setTimeout(() => {
                        reject(new Error('TIMEOUT'));
                    }, fabricUtil.getRemainingTimeout(startTime, timeout, this.configSmallestTimeout));

                    let result = await channel.sendTransaction(transactionRequest);
                    clearTimeout(timeoutHandle);
                    resolve(result);
                });

                broadcastResponse = await responsePromise;
            } catch (err) {
                // missing the ACK does not mean anything, the Tx could be already under ordering
                // so let the events decide the final status, but log this error
                invokeStatus.Set(`broadcast_error_${targetOrderer}`, err.message);
                logger.warn(`Broadcast error from ${targetOrderer}: ${err.message}`);
            }

            invokeStatus.Set('time_orderer_ack', Date.now());

            if (broadcastResponse.status !== 'SUCCESS') {
                invokeStatus.Set(`broadcast_response_error_${targetOrderer}`, broadcastResponse.status);

                // the submission was explicitly rejected, so the Tx will definitely not be ordered
                invokeStatus.SetVerification(true);
                errors.push(new Error(`${targetOrderer} response error with status ${broadcastResponse.status}`));
                throw errors;
            }

            //////////////////////////////
            // PROCESSING EVENT RESULTS //
            //////////////////////////////

            // this shouldn't throw, otherwise the error handling is not robust
            let eventResults = await Promise.all(eventPromises);

            // NOTE: this is the latency@threshold support described by the PSWG in their first paper
            let failedNotifications = eventResults.filter(er => !er.successful);

            // NOTE: an error from any peer indicates some problem, don't mask it;
            // although one successful transaction should be enough for "eventual" success;
            // errors from some peer indicate transient problems, errors from all peers probably indicate validation errors
            if (failedNotifications.length > 0) {
                invokeStatus.SetStatusFail();

                let logMsg = `Transaction[${txId.substring(0, 10)}] commit errors:`;
                for (let commitErrors of failedNotifications) {
                    logMsg += `\n\t- ${commitErrors.message}`;
                }

                logger.error(logMsg);
            } else {
                // sort ascending by finish time
                eventResults.sort((a, b) => a.time - b.time);

                // transform to (0,length] by *, then to (-1,length-1] by -, then to [0,length-1] by ceil
                let thresholdIndex = Math.ceil(eventResults.length * this.configLatencyThreshold - 1);

                // every commit event contained a VALID code
                // mark the time corresponding to the set threshold
                invokeStatus.SetStatusSuccess(eventResults[thresholdIndex].time);
            }
        } catch (err) {
            invokeStatus.SetStatusFail();

            // not the expected error array was thrown, an unexpected error occurred, log it with stack if available
            if (!Array.isArray(err)) {
                invokeStatus.Set('unexpected_error', err.message);
                logger.error(`Transaction[${txId.substring(0, 10)}] unexpected error: ${err.stack ? err.stack : err}`);
            } else if (err.length > 0) {
                let logMsg = `Transaction[${txId.substring(0, 10)}] life-cycle errors:`;
                for (let execError of err) {
                    logMsg += `\n\t- ${execError.message}`;
                }

                logger.error(logMsg);
            }
        }

        return invokeStatus;
    }

    //////////////////////////
    // PUBLIC API FUNCTIONS //
    //////////////////////////

    /**
     * Prepares the adapter by loading user data and connection to the event hubs.
     *
     * @param {string} name Unused.
     * @param {object} args The arguments from the adapter of the main process.
     * @param {number} clientIdx The client index.
     * @return {Promise<{networkInfo : FabricNetwork, eventSources: EventSource[]}>} Returns the network utility object.
     * @async
     */
    async getContext(name, args, clientIdx) {
        if (args) {
            logger.debug(`Received client args: ${JSON.stringify(args)}`);
            this.evmContractDescriptors = args.evmContractDescriptors;
            this.evmUserAddresses = args.evmUserAddresses;
            this.clientMaterialStore = args.clientMaterialStore;
        }

        // reload the profiles silently
        await this._initializeRegistrars(false);
        await this._initializeAdmins(false);
        await this._initializeUsers(false);

        for (let channel of this.network.getChannels()) {
            // initialize the channels by getting the config from the orderer
            //await this._initializeChannel(this.registrarProfiles, channel);
            await fabricUtil.initializeChannel(this.adminProfiles, channel);
            await fabricUtil.initializeChannel(this.clientProfiles, channel);
        }

        this.clientIndex = clientIdx;
        this.txIndex = -1; // reset counter for new test round

        if (this.network.isInCompatibilityMode()) {
            // NOTE: for old event hubs we have a single connection to every peer set as an event source
            const EventHub = require('fabric-client/lib/EventHub.js');

            for (let peer of this.network.getAllEventSources()) {
                let org = this.network.getOrganizationOfPeer(peer);
                let admin = this.adminProfiles.get(org);

                let eventHub = new EventHub(admin);
                eventHub.setPeerAddr(this.network.getPeerEventUrl(peer),
                    this.network.getGrpcOptionsOfPeer(peer));

                // we can use the same peer for multiple channels in case of peer-level eventing
                this.eventSources.push({
                    channel: this.network.getChannelsOfPeer(peer),
                    peer: peer,
                    eventHub: eventHub
                });
            }
        } else {
            // NOTE: for channel event hubs we might have multiple connections to a peer,
            // so connect to the defined event sources of every org in every channel
            for (let channel of this.network.getChannels()) {
                for (let org of this.network.getOrganizationsOfChannel(channel)) {
                    let admin = this.adminProfiles.get(org);

                    // The API for retrieving channel event hubs changed, from SDK v1.2 it expects the MSP ID of the org
                    let orgId = this.version.lessThan('1.2.0') ? org : this.network.getMspIdOfOrganization(org);

                    let eventHubs = admin.getChannel(channel, true).getChannelEventHubsForOrg(orgId);

                    // the peer (as an event source) is associated with exactly one channel in case of channel-level eventing
                    for (let eventHub of eventHubs) {
                        this.eventSources.push({
                            channel: [channel],
                            peer: this.network.getPeerNameOfEventHub(eventHub),
                            eventHub: eventHub
                        });
                    }
                }
            }
        }

        this.eventSources.forEach((es) => {
            es.eventHub.connect(false);
        });

        // rebuild the event source cache
        this.channelEventSourcesCache = new Map();

        for (let es of this.eventSources) {
            let channels = es.channel;

            // an event source can be used for multiple channels in compatibility mode
            for (let c of channels) {
                // initialize the cache for a channel with an empty array at the first time
                if (!this.channelEventSourcesCache.has(c)) {
                    this.channelEventSourcesCache.set(c, []);
                }

                // add the event source to the channels collection
                let eventSources = this.channelEventSourcesCache.get(c);
                eventSources.push(es);
            }
        }

        return {
            networkInfo: this.network,
            evmUserAddresses: this.evmUserAddresses,
            evmContractDescriptors: this.evmContractDescriptors
        };
    }

    /**
     * Initializes the Fabric adapter: sets up clients, admins, registrars, channels and chaincodes.
     * @async
     */
    async init() {
        let tlsInfo = this.network.isMutualTlsEnabled() ? 'mutual'
            : (this.network.isTlsEnabled() ? 'server' : 'none');
        let compMode = this.network.isInCompatibilityMode() ? '; Fabric v1.0 compatibility mode' : '';
        logger.info(`Fabric SDK version: ${this.version.toString()}; TLS: ${tlsInfo}${compMode}`);

        await this._initializeRegistrars(true);
        await this._initializeAdmins(true);
        await this._initializeUsers(true);

        if (await this._createChannels()) {
            logger.info(`Sleeping ${this.configSleepAfterCreateChannel / 1000.0}s...`);
            await util.sleep(this.configSleepAfterCreateChannel);
        }

        if (await this._joinChannels()) {
            logger.info(`Sleeping ${this.configSleepAfterJoinChannel / 1000.0}s...`);
            await util.sleep(this.configSleepAfterJoinChannel);
        }
    }

    /**
     * Installs and initializes the specified chaincodes.
     * @async
     */
    async installSmartContract() {
        await this._installChaincodes();
        if (await this._instantiateChaincodes()) {
            logger.info(`Sleeping ${this.configSleepAfterInstantiateChaincode / 1000.0}s...`);
            await util.sleep(this.configSleepAfterInstantiateChaincode);
        }
    }

    /**
     * Invokes the specified chaincode according to the provided settings.
     *
     * @param {object} context The context previously created by the Fabric adapter.
     * @param {string} contractID The unique contract ID of the target chaincode.
     * @param {string} contractVersion Unused.
     * @param {ChaincodeInvokeSettings|ChaincodeInvokeSettings[]} invokeSettings The settings (collection) associated with the (batch of) transactions to submit.
     * @param {number} timeout The timeout for the whole transaction life-cycle in seconds.
     * @return {Promise<TxStatus[]>} The result and stats of the transaction invocation.
     */
    async invokeSmartContract(context, contractID, contractVersion, invokeSettings, timeout) {
        timeout = timeout || this.configDefaultTimeout;
        let promises = [];
        let settingsArray;

        if (!Array.isArray(invokeSettings)) {
            settingsArray = [invokeSettings];
        } else {
            settingsArray = invokeSettings;
        }

        for (let settings of settingsArray) {
            let contractDetails = this.network.getContractDetails(contractID);
            if (!contractDetails) {
                throw new Error(`Could not find details for contract ID ${contractID}`);
            }

            // just resolve the contract ID
            settings.channel = contractDetails.channel;
            settings.chaincodeId = contractDetails.id;
            settings.chaincodeVersion = contractDetails.version;

            if (!settings.chaincodeArguments) {
                settings.chaincodeArguments = [];
            }

            if (!settings.invokerIdentity) {
                settings.invokerIdentity = this.defaultInvoker;
            }

            if (contractDetails.language === 'solidity') {
                solidityUtil.transformTransactionSettings(contractID, this.evmContractDescriptors, this.network, settings);
            }

            promises.push(this._submitSingleTransaction(context, settings, timeout * 1000));
        }

        return await Promise.all(promises);
    }

    /**
     * Perform required preparation for test clients, e.g. enroll clients and obtain key pairs.
     * @param {number} number Number of test clients.
     * @return {Promise<object[]>} Array of obtained material for test clients.
     * @async
     */
    async prepareClients(number) {
        let result = [];
        let shared = {
            evmContractDescriptors: this.evmContractDescriptors,
            evmUserAddresses: this.evmUserAddresses,
            clientMaterialStore: this.clientMaterialStore
        };

        logger.debug(`Sharing with clients: ${JSON.stringify(shared)}`);

        for(let i = 0 ; i< number ; i++) {
            result[i] = shared;
        }
        return result;
    }

    /**
     * Queries the specified chaincode according to the provided settings.
     *
     * @param {object} context The context previously created by the Fabric adapter.
     * @param {string} contractID The unique contract ID of the target chaincode.
     * @param {string} contractVersion Unused.
     * @param {ChaincodeQuerySettings|ChaincodeQuerySettings[]} querySettings The settings (collection) associated with the (batch of) query to submit.
     * @param {number} timeout The timeout for the call in seconds.
     * @return {Promise<TxStatus[]>} The result and stats of the transaction query.
     */
    async querySmartContract(context, contractID, contractVersion, querySettings, timeout) {
        timeout = timeout || this.configDefaultTimeout;
        let promises = [];
        let settingsArray;

        if (!Array.isArray(querySettings)) {
            settingsArray = [querySettings];
        } else {
            settingsArray = querySettings;
        }

        for (let settings of settingsArray) {
            let contractDetails = this.network.getContractDetails(contractID);
            if (!contractDetails) {
                throw new Error(`Could not find details for contract ID ${contractID}`);
            }

            settings.channel = contractDetails.channel;
            settings.chaincodeId = contractDetails.id;
            settings.chaincodeVersion = contractDetails.version;

            if (!settings.chaincodeArguments) {
                settings.chaincodeArguments = [];
            }

            if (!settings.invokerIdentity) {
                settings.invokerIdentity = this.defaultInvoker;
            }

            if (contractDetails.language === 'solidity') {
                solidityUtil.transformTransactionSettings(contractID, this.evmContractDescriptors, this.network, settings);
            }

            promises.push(this._submitSingleQuery(context, settings, timeout * 1000));
        }

        return await Promise.all(promises);
    }

    /**
     * Releases the resources of the adapter.
     *
     * @param {object} context Unused.
     * @async
     */
    async releaseContext(context) {
        this.eventSources.forEach((es) => {
            if (es.eventHub.isconnected()) {
                es.eventHub.disconnect();
            }
        });

        this.eventSources = [];
    }
}

module.exports = Fabric;