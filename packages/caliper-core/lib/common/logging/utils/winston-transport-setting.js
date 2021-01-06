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

const Config = require('../../config/config-util');

/**
 * Encapsulates settings for a Winston transport.
 */
class WinstonTransportSetting {

    /**
     * Initializes a new instance of the class.
     * @param {string} type The type of the transport.
     * @param {string} name The name of the transport.
     */
    constructor(type, name) {
        this.type = type;
        this.enabled = false;
        this.name = name;
        this.options = { level: 'debug', name: name };
    }

    /**
     * Get the Winston transport type.
     * @return {string} The type of the transport.
     */
    getType() {
        return this.type;
    }

    /**
     * Get the name of the transport.
     * @return {string} The name.
     */
    getName() {
        return this.name;
    }

    /**
     * Indicates whether the transport is enabled or not.
     * @return {boolean} True, if the transport is enabled. Otherwise false.
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Set whether the transport is enabled or not.
     * @param {boolean} enabled True, if the transport is enabled. Otherwise false.
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Get the transport options.
     * @return {object} The transport options.
     */
    getOptions() {
        return this.options;
    }

    /**
     * Set the transport options.
     * @param {object} options The transport options.
     */
    setOptions(options) {
        this.options = options;
        this.options.name = this.name;
    }

    /**
     * Load all transport settings from the configuration.
     * @return {WinstonTransportSetting[]} The list of loaded transport settings.
     */
    static loadAllFromConfiguration() {
        const transportNames = Config.get(Config.keys.Logging.Targets);

        if (typeof transportNames !== 'object') {
            throw new Error('The "caliper-logging-targets" setting must have an object as value');
        }

        return Object.keys(transportNames).map(WinstonTransportSetting._loadFromConfiguration);
    }

    /**
     * Load the settings of the given transports from the configuration.
     * @param {string} transportName The name of the transport.
     * @return {WinstonTransportSetting} The loaded transport settings.
     * @private
     */
    static _loadFromConfiguration(transportName) {
        // NOTE: read setting keys directly, so they can be easily overridden
        const target = Config.get(`${Config.keys.Logging.Targets}-${transportName}-target`);
        if (!target || typeof target !== 'string') {
            throw new Error(`Mandatory "target" attribute is missing or invalid for the "${transportName}" logging target`);
        }

        const transportSetting = new WinstonTransportSetting(target, transportName);
        transportSetting.setEnabled(Config.get(`${Config.keys.Logging.Targets}-${transportName}-enabled`, false));
        transportSetting.setOptions(Config.get(`${Config.keys.Logging.Targets}-${transportName}-target`, {level: 'error'}));

        return transportSetting;
    }
}

module.exports = WinstonTransportSetting;
