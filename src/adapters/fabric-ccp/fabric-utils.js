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

const util = require('../../comm/util.js');
const FabricClient = require('fabric-client');

const logger = util.getLogger('adapters/fabric-ccp');

/**
 * Internal utility methods for performing common Fabric-related tasks.
 */
class FabricUtils {
    /**
     * Enrolls the given user through its corresponding CA.
     * @param {Client} profile The Client object whose user must be enrolled.
     * @param {string} enrollmentId The enrollment ID.
     * @param {string} enrollmentSecret The enrollment secret.
     * @return {Promise<{key: ECDSA_KEY, certificate: string}>} The resulting private key and certificate.
     * @async
     */
    static async enrollUser(profile, enrollmentId, enrollmentSecret) {
        // this call will throw an error if the CA configuration is not found
        // this error should propagate up
        let ca = profile.getCertificateAuthority();
        try {
            return await ca.enroll({
                enrollmentID: enrollmentId,
                enrollmentSecret: enrollmentSecret
            });
        } catch (err) {
            throw new Error(`Couldn't enroll ${enrollmentId}: ${err.message}`);
        }
    }

    /**
     * Checks whether the user materials are already persisted in the local store and sets the user context if found.
     * @param {Client} profile The Client object to fill with the User instance.
     * @param {string} userName The name of the user to check and load.
     * @return {Promise<User>} The loaded User object.
     * @async
     */
    static async getUserContext(profile, userName) {
        // Check whether the materials are already saved
        // getUserContext automatically sets the user if found
        try {
            return await profile.getUserContext(userName, true);
        } catch (err) {
            throw new Error(`Couldn't check whether ${userName}'s materials are available locally: ${err.message}`);
        }
    }

    /**
     * Initializes the given channel of every client profile to be able to verify proposal responses.
     * @param {Map<string, FabricClient>} profiles The collection of client profiles.
     * @param {string} channel The name of the channel to initialize.
     * @async
     */
    static async initializeChannel(profiles, channel) {
        // initialize the channel for every client profile from the local config
        for (let profile of profiles.entries()) {
            let ch = profile[1].getChannel(channel, false);
            if (ch) {
                try {
                    await ch.initialize();
                } catch (err) {
                    logger.error(`Couldn't initialize ${channel} for ${profile[0]}: ${err.message}`);
                    throw err;
                }
            }
        }
    }

    /**
     * Tries to set the given identity as the current user context for the given profile. Enrolls it if needed and can.
     * @param {Client} profile The Client object whose user context must be set.
     * @param {string} userName The name of the user.
     * @param {string} password The password for the user.
     * @async
     */
    static async setUserContextByEnrollment(profile, userName, password) {
        try {
            // automatically tries to enroll the given identity with the CA (must be registered)
            await profile.setUserContext({
                username: userName,
                password: password
            }, false);
        } catch (err) {
            throw new Error(`Couldn't enroll ${userName} or set it as user context: ${err.message}`);
        }
    }

    /**
     * Partially assembles a Client object containing general network information.
     * @param {FabricNetwork} network The Fabric network descriptor.
     * @param {string} client The name of the client to base the profile on.
     * @return {Promise<Client>} The partially assembled Client object.
     * @async
     */
    static async prepareClientProfile(network, client) {
        // load the general network data from a clone of the network object
        // NOTE: if we provide a common object instead, the Client class will use it directly,
        // and it will be overwritten when loading the next client
        let profile = FabricClient.loadFromConfig(network.getNewNetworkObject());
        profile.loadFromConfig({
            version: '1.0',
            client: network.getClientObject(client)
        });

        try {
            await profile.initCredentialStores();
        } catch (err) {
            throw new Error(`Couldn't initialize the credential stores for ${client}: ${err.message}`);
        }

        return profile;
    }

    /**
     * Initializes the registrar of the given organization.
     *
     * @param {string} org The name of the organization.
     * @param {FabricNetwork} network The Fabric network descriptor.
     * @param {Map<string, Client>} profiles The registrar profile store/map.
     * @param {boolean} verbose Indicates whether to log the init progress.
     * @async
     */
    static async loadRegistrarOfOrganization(org, network, profiles, verbose) {
        let logWarn = verbose ? logger.warn : logger.debug;
        let logInfo = verbose ? logger.info : logger.debug;

        // providing registrar information is optional and only needed for user registration and enrollment
        let registrarInfo = network.getRegistrarOfOrganization(org);
        if (!registrarInfo) {
            logWarn(`${org}'s registrar information not provided.`);
            return;
        }

        // build the common part of the profile
        let profile = await FabricUtils.prepareClientProfile(network, network.getFirstClientOfOrganization(org));
        // check if the materials already exist locally
        let registrar = await FabricUtils.getUserContext(profile, registrarInfo.enrollId);

        if (registrar) {
            logWarn(`${org}'s registrar's materials found locally. Make sure it is the right one!`);
            profiles.set(org, profile);
            return;
        }

        // set the registrar identity as the current user context
        await FabricUtils.setUserContextByEnrollment(profile, registrarInfo.enrollId, registrarInfo.enrollSecret);

        profiles.set(org, profile);
        logInfo(`${org}'s registrar enrolled successfully`);
    }

    /**
     * Creates and sets a User object as the context based on the provided identity information.
     * @param {Client} profile The Client object whose user context must be set.
     * @param {string} mspid The MSP ID of the user's organization.
     * @param {string} userName The name of the user.
     * @param {{privateKeyPEM: Buffer, signedCertPEM: Buffer}} cryptoContent The object containing the signing key and cert in PEM format.
     * @async
     */
    static async createUser(profile, mspid, userName, cryptoContent) {
        // set the user explicitly based on its crypto materials
        // createUser also sets the user context
        try {
            await profile.createUser({
                username: userName,
                mspid: mspid,
                cryptoContent: cryptoContent,
                skipPersistence: false
            });
        } catch (err) {
            throw new Error(`Couldn't create user ${userName}: ${err.message}`);
        }
    }

    /**
     * Initializes the admin of the given organization.
     *
     * @param {string} org The name of the organization.
     * @param {FabricNetwork} network The Fabric network descriptor.
     * @param {Map<string, Client>} profiles The admin profile store/map.
     * @param {boolean} verbose Indicates whether to log the init progress.
     * @async
     */
    static async loadAdminOfOrganization(org, network, profiles, verbose) {
        let logWarn = verbose ? logger.warn : logger.debug;
        let logInfo = verbose ? logger.info : logger.debug;

        let adminName = `admin.${org}`;
        // build the common part of the profile
        let adminProfile = await FabricUtils.prepareClientProfile(network, network.getFirstClientOfOrganization(org));

        // check if the materials already exist locally
        let admin = await FabricUtils.getUserContext(adminProfile, adminName);

        if (admin) {
            if (network.isMutualTlsEnabled()) {
                let crypto = network.getAdminCryptoContentOfOrganization(org);
                adminProfile.setTlsClientCertAndKey(crypto.signedCertPEM.toString(), crypto.privateKeyPEM.toString());
            }

            profiles.set(org, adminProfile);
            logWarn(`${org}'s admin's materials found locally. Make sure it is the right one!`);
            return;
        }

        // set the admin explicitly based on its crypto materials
        await FabricUtils.createUser(adminProfile, network.getMspIdOfOrganization(org),
            adminName, network.getAdminCryptoContentOfOrganization(org));

        if (network.isMutualTlsEnabled()) {
            let crypto = network.getAdminCryptoContentOfOrganization(org);
            adminProfile.setTlsClientCertAndKey(crypto.signedCertPEM.toString(), crypto.privateKeyPEM.toString());
        }

        profiles.set(org, adminProfile);
        logInfo(`${org}'s admin's materials are successfully loaded`);
    }

    /**
     * Calculates the remaining time to timeout based on the original timeout and a starting time.
     * @param {number} start The epoch of the start time in ms.
     * @param {number} original The original timeout in ms.
     * @param {number} threshold The smallest allowed timeout value.
     * @returns {number} The remaining time until the timeout in ms.
     * @private
     */
    static getRemainingTimeout(start, original, threshold) {
        let newTimeout = original - (Date.now() - start);
        if (newTimeout < threshold) {
            logger.warn(`Timeout is too small, default value of ${threshold}ms is used instead`);
            newTimeout = threshold;
        }

        return newTimeout;
    }

    /**
     * Loads/registers/enrolls a client for the given organization.
     * @param {string} client The name of the client.
     * @param {FabricNetwork} network The Fabric network descriptor.
     * @param {Map<string, Client>} profiles The client profile store/map.
     * @param {Map<string, {certPem: string, keyPem: string}>} clientMaterialStore The store for the client materials
     * @param {Map<string, Client>} registrarProfiles The registrar profile store/map.
     * @param {boolean} verbose Indicates whether to log the init progress.
     */
    static async loadUser(client, network, profiles, clientMaterialStore, registrarProfiles, verbose) {
        let logWarn = verbose ? logger.warn : logger.debug;
        let logInfo = verbose ? logger.info : logger.debug;

        let org = network.getOrganizationOfClient(client);
        let orgMspId = network.getMspIdOfOrganization(org);

        // create the profile based on the connection profile
        let clientProfile = await FabricUtils.prepareClientProfile(network, client);
        profiles.set(client, clientProfile);

        // check if the materials already exist locally
        let user = await FabricUtils.getUserContext(clientProfile, client);
        if (user) {
            if (network.isMutualTlsEnabled()) {
                clientProfile.setTlsClientCertAndKey(clientMaterialStore[client].certPem, clientMaterialStore[client].keyPem);
                // "retrieve" and set the deserialized cert and key
                //clientProfile.setTlsClientCertAndKey(user.getIdentity()._certificate, user.getSigningIdentity()._signer._key.toBytes());
            }

            logWarn(`${client}'s materials found locally. Make sure it is the right one!`);
            return;
        }

        let cryptoContent = network.getClientCryptoContent(client);
        if (cryptoContent) {
            // the client is already enrolled, just create and persist the User object
            await FabricUtils.createUser(clientProfile, orgMspId, client, cryptoContent);
            let certPem = cryptoContent.signedCertPEM.toString();
            let keyPem = cryptoContent.privateKeyPEM.toString();

            // share the data with the clients
            clientMaterialStore[client] = {
                certPem: certPem,
                keyPem: keyPem
            };

            if (network.isMutualTlsEnabled()) {
                // the materials are included in the configuration file
                clientProfile.setTlsClientCertAndKey(certPem, keyPem);
            }

            logInfo(`${client}'s materials are successfully loaded`);
            return;
        }

        // The user needs to be enrolled or even registered

        // if the enrollment ID and secret is provided, then enroll the already registered user
        let enrollmentSecret = network.getClientEnrollmentSecret(client);
        if (enrollmentSecret) {
            let enrollment = await FabricUtils.enrollUser(clientProfile, client, enrollmentSecret);
            let certAndKey = {
                privateKeyPEM: enrollment.key.toBytes(),
                signedCertPEM: Buffer.from(enrollment.certificate)
            };
            // create the new user based on the retrieved materials
            await FabricUtils.createUser(clientProfile, orgMspId, client, certAndKey);

            if (network.isMutualTlsEnabled()) {
                // set the received cert and key for mutual TLS
                let certPem = Buffer.from(enrollment.certificate).toString();
                let keyPem = enrollment.key.toString();

                // share the data with the clients
                clientMaterialStore[client] = {
                    certPem: certPem,
                    keyPem: keyPem
                };
                clientProfile.setTlsClientCertAndKey(certPem, keyPem);
            }

            logInfo(`${client} successfully enrolled`);
            return;
        }

        // Otherwise, register then enroll the user
        let registrarProfile = registrarProfiles.get(org);

        if (!registrarProfile) {
            throw new Error(`Registrar identity is not provided for ${org}`);
        }

        let secret;
        try {
            let registrarInfo = network.getRegistrarOfOrganization(org);
            let registrar = await registrarProfile.getUserContext(registrarInfo.enrollId, true);
            // this call will throw an error if the CA configuration is not found
            // this error should propagate up
            let ca = clientProfile.getCertificateAuthority();
            let userAffiliation = network.getAffiliationOfClient(client);

            // if not in compatibility mode (i.e., at least SDK v1.1), check whether the affiliation is already registered or not
            if (!network.isInCompatibilityMode()) {
                let affService = ca.newAffiliationService();
                let affiliationExists = false;
                try {
                    await affService.getOne(userAffiliation, registrar);
                    affiliationExists = true;
                } catch (err) {
                    logInfo(`${userAffiliation} affiliation doesn't exists`);
                }

                if (!affiliationExists) {
                    await affService.create({name: userAffiliation, force: true}, registrar);
                    logInfo(`${userAffiliation} affiliation added`);
                }
            }

            let attributes = network.getAttributesOfClient(client);
            attributes.push({name: 'hf.Registrar.Roles', value: 'client'});

            secret = await ca.register({
                enrollmentID: client,
                affiliation: userAffiliation,
                role: 'client',
                attrs: attributes
            }, registrar);
        } catch (err) {
            throw new Error(`Couldn't register ${client}: ${err.message}`);
        }

        logInfo(`${client} successfully registered`);

        let enrollment = await FabricUtils.enrollUser(clientProfile, client, secret);

        // create the new user based on the retrieved materials
        await FabricUtils.createUser(clientProfile, orgMspId, client,
            { privateKeyPEM: enrollment.key.toBytes(), signedCertPEM: Buffer.from(enrollment.certificate) });

        if (network.isMutualTlsEnabled()) {
            // set the received cert and key for mutual TLS
            let certPem = Buffer.from(enrollment.certificate).toString();
            let keyPem = enrollment.key.toString();

            // share the data with the clients
            clientMaterialStore[client] = {
                certPem: certPem,
                keyPem: keyPem
            };
            clientProfile.setTlsClientCertAndKey(certPem, keyPem);
        }

        logInfo(`${client} successfully enrolled`);
    }
}

module.exports = FabricUtils;