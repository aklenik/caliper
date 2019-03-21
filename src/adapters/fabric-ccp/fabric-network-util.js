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

const fs = require('fs');
const child_process = require('child_process');
const tmp = require('tmp');
const util = require('../../comm/util.js');
const FabricClient = require('fabric-client');

const logger = util.getLogger('adapters/fabric-ccp/network');

/**
 * Internal utility class for processing raw network artifact objects (independently of the loaded network configuration).
 */
class FabricNetworkUtil {
    /**
     * Logs and throws an error.
     * @param {string} msg The message to log and throw.
     */
    static logAndThrow(msg) {
        logger.error(msg);
        throw new Error(msg);
    }

    /**
     * Internal utility function for checking whether the given node exists in the configuration.
     * The function throws an error if it doesn't exist.
     * @param {string} nodeToCheck The name of the node.
     * @param {object} existingNodes The object that contains all the nodes as its sub-keys.
     * @param {string} location A string identifying the location where the node reference is used.
     */
    static assertNodeExists(nodeToCheck, existingNodes, location) {
        if (!existingNodes.some(node => node === nodeToCheck)) {
            FabricNetworkUtil.logAndThrow(`'${location}' is not a valid node reference`);
        }
    }

    /**
     * Internal utility function for checking whether the given nodes exist in the provided list.
     * The function throws an error if any of the nodes doesn't exist.
     * @param {string[]} nodesToCheck The list of nodes to check.
     * @param {string[]} existingNodes The list of valid node references.
     * @param {string} location The location where the reference is used in the configuration file.
     */
    static assertAllNodesExist(nodesToCheck, existingNodes, location) {
        if (nodesToCheck.length < 1) {
            FabricNetworkUtil.logAndThrow(`'${location}' is an empty reference list`);
        }

        nodesToCheck.forEach(node => FabricNetworkUtil.assertNodeExists(node, existingNodes, `${location}.${node}`));
    }

    /**
     * Gets the admin crypto materials for the given organization.
     * @param {object} orgObject The object representing the organization.
     * @returns {{privateKeyPEM: Buffer, signedCertPEM: Buffer}} The object containing the signing key and cert in PEM format.
     */
    static getAdminCryptoContentOfOrganization(orgObject) {
        // if either is missing, the result is undefined
        if (!util.checkAllProperties(orgObject, 'adminPrivateKey', 'signedCert')) {
            return undefined;
        }

        let privateKey = orgObject.adminPrivateKey;
        let signedCert = orgObject.signedCert;

        let privateKeyPEM;
        let signedCertPEM;

        if (util.checkProperty(privateKey, 'path')) {
            privateKeyPEM = fs.readFileSync(util.resolvePath(privateKey.path));
        } else {
            privateKeyPEM = privateKey.pem;
        }

        if (util.checkProperty(signedCert, 'path')) {
            signedCertPEM = fs.readFileSync(util.resolvePath(signedCert.path));
        } else {
            signedCertPEM = signedCert.pem;
        }

        // if either is missing, the result is undefined
        if (!privateKeyPEM || !signedCertPEM) {
            return undefined;
        }

        return {
            privateKeyPEM: privateKeyPEM,
            signedCertPEM: signedCertPEM
        };
    }

    /**
     * Gets the affiliation of the given client.
     * @param {object} clientObj The object representing the client.
     * @returns {string} The affiliation or 'undefined' if omitted from the configuration.
     */
    static getAffiliationOfClient(clientObj) {
        return util.checkProperty(clientObj, 'affiliation') ? clientObj.affiliation : undefined;
    }

    /**
     * Gets the registration attributes of the given client.
     * @param {object} clientObj The object representing the client.
     * @returns {{name: string, value: string, ecert: boolean}[]} The attributes or empty array if omitted from the configuration.
     */
    static getAttributesOfClient(clientObj) {
        return util.checkProperty(clientObj, 'attributes') ? clientObj.attributes : [];
    }

    /**
     * Gets the first CA name for the given organization.
     * @param {object} orgObj The object representing the organization.
     * @returns {string} The CA name.
     */
    static getCertificateAuthorityOfOrganization(orgObj) {
        // TODO: only one CA per org is supported
        return util.checkProperty(orgObj, 'certificateAuthorities') && orgObj.certificateAuthorities.length >0
            ? orgObj.certificateAuthorities[0] : undefined;
    }

    /**
     * Gets the chaincode names and versions belonging to the given channel.
     * @param {object} channelObj The object representing the channel.
     * @returns {Set<{id: string, version: string, language: string}>} The set of chaincode information.
     */
    static getAllChaincodesOfChannel(channelObj) {
        return new Set(channelObj.chaincodes.map(cc => {
            return {
                id: cc.id,
                version: cc.version,
                language: cc.language
            };
        }));
    }

    /**
     * Gets the crypto materials for the given user.
     * @param {object} clientObj The object representing the client.
     * @returns {{privateKeyPEM: Buffer, signedCertPEM: Buffer}} The object containing the signing key and cert.
     */
    static getClientCryptoContent(clientObj) {
        if (!util.checkAllProperties(clientObj, 'clientPrivateKey', 'clientSignedCert')) {
            return undefined;
        }

        let privateKey = clientObj.clientPrivateKey;
        let signedCert = clientObj.clientSignedCert;
        let privateKeyPEM;
        let signedCertPEM;

        if (util.checkProperty(privateKey, 'path')) {
            privateKeyPEM = fs.readFileSync(util.resolvePath(privateKey.path));
        } else {
            privateKeyPEM = privateKey.pem;
        }

        if (util.checkProperty(signedCert, 'path')) {
            signedCertPEM = fs.readFileSync(util.resolvePath(signedCert.path));
        } else {
            signedCertPEM = signedCert.pem;
        }

        return {
            privateKeyPEM: privateKeyPEM,
            signedCertPEM: signedCertPEM
        };
    }

    /**
     * Gets the enrollment secret of the given client.
     * @param {object} clientObj The object representing the client.
     * @returns {string} The enrollment secret.
     */
    static getClientEnrollmentSecret(clientObj) {
        return util.checkProperty(clientObj, 'enrollmentSecret') ? clientObj.enrollmentSecret : undefined;
    }

    /**
     * Gets the contract ID of a chaincode.
     * @param {object} channelObj The object representing the channel.
     * @param {string} ccId The ID of the chaincode.
     * @param {string} ccVersion The version of the chaincode.
     * @return {object} The object representing the chaincode.
     */
    static getChaincodeOfChannel(channelObj, ccId, ccVersion) {
        let ccObj = channelObj.chaincodes.find(e => e.id === ccId && e.version === ccVersion);
        if (!ccObj) {
            FabricNetworkUtil.logAndThrow(`Couldn't find ${ccId}@${ccVersion}`);
        }

        return ccObj;
    }

    /**
     * Gets the contract ID of a chaincode.
     * @param {object} chaincodeObj The object representing the chaincode.
     * @return {string} The contract ID of the chaincode (which is the normal ID, if a contract ID is not specified).
     */
    static getContractIdOfChaincode(chaincodeObj) {
        return util.checkProperty(chaincodeObj, 'contractID') ? chaincodeObj.contractID : chaincodeObj.id;
    }

    /**
     * Gets the peer names on which chaincodes of the given channel should be installed and instantiated.
     * @param {object} channelObj The object representing the channel.
     * @returns {Set<string>} The set of peer names.
     */
    static getTargetPeersOfChannel(channelObj) {
        // we need to gather the target peers from the channel's peer section
        // based on their provided functionality (endorsing and cc query)
        let results = new Set();
        let peers = channelObj.peers;
        for (let key in peers) {
            if (!peers.hasOwnProperty(key)) {
                continue;
            }

            let peer = peers[key];
            // if only the peer name is present in the config, then it is a target based on the default values
            if (!util.checkDefined(peer)) {
                results.add(key.toString());
            }

            // the default value of 'endorsingPeer' is true, or it's explicitly set to true
            if (!util.checkProperty(peer, 'endorsingPeer') ||
                (util.checkProperty(peer, 'endorsingPeer') && peer.endorsingPeer)) {
                results.add(key.toString());
                continue;
            }

            // the default value of 'chaincodeQuery' is true, or it's explicitly set to true
            if (!util.checkProperty(peer, 'chaincodeQuery') ||
                (util.checkProperty(peer, 'chaincodeQuery') && peer.chaincodeQuery)) {
                results.add(key.toString());
            }
        }

        return results;
    }

    /**
     * Gets the peer names on which the chaincodes should be installed and instantiated.
     * @param {object} chaincodeObj The object representing the chaincode.
     * @returns {Set<string>} The set of peer names or undefined, if not specified.
     */
    static getTargetPeersOfChaincode(chaincodeObj) {
        return util.checkProperty(chaincodeObj, 'targetPeers') ? new Set(chaincodeObj.targetPeers) : undefined;
    }

    /**
     * Constructs an N-of-N endorsement policy for the given organizations.
     * @param {string[]} orgMspIds The list of organization MSP IDs.
     * @return {object} The assembled endorsement policy.
     */
    static getEndorsementPolicyForOrganizations(orgMspIds) {
        let policy = {
            identities: [],
            policy: {}
        };

        policy.policy[`${orgMspIds.length}-of`] = [];

        for (let i = 0; i < orgMspIds.length; ++i) {
            policy.identities[i] = {
                role: {
                    name: 'member',
                    mspId: orgMspIds[i]
                }
            };

            policy.policy[`${orgMspIds.length}-of`][i] = {
                'signed-by': i
            };
        }

        return policy;
    }

    /**
     * Gets the TLS CA certificate of the given peer.
     * @param {object} peerObj The object representing the peer.
     * @return {string} The PEM encoded CA certificate.
     */
    static getTlsCaCertificateOfPeer(peerObj) {
        if (!util.checkProperty(peerObj, 'tlsCACerts')) {
            return undefined;
        }

        let tlsCACert = peerObj.tlsCACerts;
        let tlsPEM;

        if (util.checkProperty(tlsCACert, 'path')) {
            tlsPEM = fs.readFileSync(util.resolvePath(tlsCACert.path)).toString();
        } else {
            tlsPEM = tlsCACert.pem;
        }

        return tlsPEM;
    }

    /**
     * Gets the GRPC options of the peer extended with the CA certificate PEM of the peer if present.
     * @param {object} peerObj The object representing the peer.
     * @return {object} An object containing the GRPC options of the peer.
     */
    static getGrpcOptionsOfPeer(peerObj) {
        let grpcObj = peerObj.grpcOptions || {};

        if (util.checkProperty(peerObj, 'tlsCACerts')) {
            grpcObj.pem = FabricNetworkUtil.getTlsCaCertificateOfPeer(peerObj);
        }

        return grpcObj;
    }

    /**
     * Gets the MSP ID of the given organization.
     * @param {object} orgObj The object representing the organization.
     * @returns {string} The MSP ID.
     */
    static getMspIdOfOrganization(orgObj) {
        return orgObj.mspid;
    }

    /**
     * Gets the orderer names belonging to the given channel.
     * @param {object} channelObj The object representing the channel.
     * @returns {Set<string>} The set of orderer names.
     */
    static getOrderersOfChannel(channelObj) {
        return new Set(channelObj.orderers);
    }

    /**
     * Gets the organization name that the given client belongs to.
     * @param {object} clientObj The object representing the client.
     * @returns {string} The organization name.
     */
    static getOrganizationOfClient(clientObj) {
        return clientObj.organization;
    }

    /**
     * Gets the event connection URL of the given peer.
     * @param {object} peerObj The object representing the peer.
     * @return {string} The event URL of the peer.
     */
    static getPeerEventUrl(peerObj) {
        return peerObj.eventUrl;
    }

    /**
     * Gets the cleaned up connection URL of the given peer.
     * @param {object} peerObj The object representing the peer.
     * @return {string} The URL of the peer.
     */
    static getCleanUrlOfPeer(peerObj) {
        return peerObj.url.replace(/(^\w+:|^)\/\//, '');
    }

    /**
     * Gets the peer names belonging to the given channel.
     * @param {object} channelObj The object representing the channel.
     * @returns {Set<string>} The set of peer names.
     */
    static getPeersOfChannel(channelObj) {
        return new Set(Object.keys(channelObj.peers));
    }

    /**
     * Gets the peer names belonging to the given organization.
     * @param {object} orgObj The object representing the organization.
     * @returns {Set<string>} The set of peer names.
     */
    static getPeersOfOrganization(orgObj) {
        return new Set(orgObj.peers);
    }

    /**
     * Gets the registrar belonging to the given CA.
     * @param {object} caObj The object representing the CA.
     * @returns {{enrollId: string, enrollSecret: string}} The enrollment ID and secret of the registrar.
     */
    static getRegistrarOfCertificateAuthority(caObj) {
        // TODO: only one registrar per CA is supported
        return caObj && util.checkProperty(caObj, 'registrar') &&
            caObj.registrar.length > 0 ? caObj.registrar[0] : undefined;
    }

    /**
     * Gets the transient map for the given chaincode for the given channel.
     * @param {object} chaincodeObj The object representing the chaincode.
     * @return {Map<string, Buffer>} The map of attribute names to byte arrays.
     */
    static getTransientMapOfChaincode(chaincodeObj) {
        let map = {};
        if (!util.checkProperty(chaincodeObj, 'initTransientMap')) {
            return map;
        }

        for (let key of Object.keys(chaincodeObj.initTransientMap)) {
            let value = chaincodeObj.initTransientMap[key];
            map[key.toString()] = Buffer.from(value.toString());
        }

        return map;
    }

    /**
     * Extracts the channel configuration directly from the configuration.
     * @param {object} channelObject The channel configuration object.
     * @return {Buffer} The extracted channel configuration bytes.
     */
    static getChannelConfigFromConfiguration(channelObject) {
        // spawn a configtxlator process and encode the config object through a temporary file
        // NOTES:
        // 1) there doesn't seem to be a straightforward SDK API for this
        // 2) sync is okay in Caliper initialization phase
        // 3) for some reason configtxlator cannot open /dev/stdin and stdout when buffers are attached to them
        // so temporary files have to be used
        // ./configtxlator proto_encode --type=common.ConfigUpdate --input=tmpInputFile --output=tmpOutputFile
        let binaryPath = util.resolvePath(channelObject.configtxlatorPath);
        let tmpInputFile = null;
        let tmpOutputFile = null;
        try {
            tmpInputFile = tmp.tmpNameSync();
            tmpOutputFile = tmp.tmpNameSync();
            fs.writeFileSync(tmpInputFile, JSON.stringify(channelObject.configUpdateObject));
            let result = child_process.spawnSync(binaryPath, ['proto_encode', '--type=common.ConfigUpdate', `--output=${tmpOutputFile}`, `--input=${tmpInputFile}`]);
            if (result.error) {
                throw new Error(`Couldn't encode channel config update: ${result.error.message}`);
            }

            if (result.status !== 0) {
                let stderr = Buffer.from(result.stderr, 'utf-8').toString();
                let stdout = Buffer.from(result.stdout, 'utf-8').toString();
                logger.error(`configtxlator stderr output:\n${stderr}`);
                logger.error(`configtxlator stdout output:\n${stdout}`);
                throw new Error(`Couldn't encode channel config update: exit status is ${result.status}`);
            }

            return fs.readFileSync(tmpOutputFile);
        } catch (err) {
            throw err;
        } finally {
            if (tmpInputFile && fs.existsSync(tmpInputFile)) {
                fs.unlinkSync(tmpInputFile);
            }
            if (tmpOutputFile && fs.existsSync(tmpOutputFile)) {
                fs.unlinkSync(tmpOutputFile);
            }
        }
    }

    /**
     * Extracts the channel configuration from the configured file.
     * @param {object} channelObject The channel configuration object.
     * @return {Buffer} The extracted channel configuration bytes.
     * @private
     */
    static getChannelConfigFromFile(channelObject) {
        // extracting the config from the binary file
        let binaryPath = util.resolvePath(channelObject.configBinary);
        let envelopeBytes;

        try {
            envelopeBytes = fs.readFileSync(binaryPath);
        } catch (err) {
            throw new Error(`Couldn't read configuration binary for channel: ${err.message}`);
        }

        try {
            return new FabricClient().extractChannelConfig(envelopeBytes);
        } catch (err) {
            throw new Error(`Couldn't extract configuration object for channel: ${err.message}`);
        }
    }
}

module.exports = FabricNetworkUtil;