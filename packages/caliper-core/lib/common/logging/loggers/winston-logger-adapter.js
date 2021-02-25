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

const winston = require('winston');
require('winston-daily-rotate-file');

const {LoggingLevels, LoggerInterface} = require('./logger-interface');
const Config = require('../../config/config-util');
const WinstonTransportSetting = require('../utils/winston-transport-setting');

const Drop = require('../winston-formats/drop');
const PadLevel = require('../winston-formats/pad-level');
const AttributeFormatterOptions = require('../winston-format-options/attribute-formatter-options');
const AttributeFormatter = require('../winston-formats/attribute-formatter');
const ColorizeOptions = require('../winston-format-options/colorize-options');
const Colorize = require('../winston-formats/colorize');
const MessageFormat = require('../winston-formats/message-format');

const DefaultMessageTemplate = '%timestamp%%level%%label%%module%%message%%metadata%';

/**
 * Class for bridging the winston logger interface with the Caliper logger interface.
 */
class WinstonLoggerAdapter extends LoggerInterface {
    /**
     * Creates a new instance of the {@type WinstonLoggerAdapter} class.
     * @param {winston.Logger} winstonLogger The winston logger instance to bridge. Defaults to the default winston logger instance.
     */
    constructor(winstonLogger = winston) {
        super();
        this.winstonLogger = winstonLogger;
    }

    /**
     * Log a debug level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    debug(message, ...metadata) {
        this.winstonLogger.debug(message, this._wrapMetadataInObject(metadata));
    }

    /**
     * Log an info level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    info(message, ...metadata) {
        this.winstonLogger.info(message, this._wrapMetadataInObject(metadata));
    }

    /**
     * Log a warning level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    warn(message, ...metadata) {
        this.winstonLogger.warn(message, this._wrapMetadataInObject(metadata));
    }

    /**
     * Log an error level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    error(message, ...metadata) {
        this.winstonLogger.error(message, this._wrapMetadataInObject(metadata));
    }

    /**
     * Configure the underlying winston object based on the Caliper configuration.
     * NOTE: no need for this for child logger adapters.
     * @param {object[]} formats Winston formats to use during logging. Defaults to the configured formats.
     * @param {object[]} transports Winston transports to use during logging. Defaults to the configured formats.
     */
    configure(formats = undefined, transports = undefined) {
        const finalTransports = transports || this._loadConfiguredTransports();
        const finalFormats = formats || this._loadConfiguredFormats(finalTransports);

        // reconfigure instance
        this.winstonLogger.configure({
            levels: LoggingLevels,
            format: winston.format.combine(...finalFormats),
            transports: finalTransports
        });
    }

    /**
     * Creates a winston child logger adapter.
     * @param {string} moduleName The module name the child logger should add as metadata.
     * @return {WinstonLoggerAdapter} The child logger.
     */
    createChildLogger(moduleName) {
        return new WinstonLoggerAdapter(
            this.winstonLogger.child({ module: moduleName })
        );
    }

    /**
     * Wrap the arbitrary metadata array in a log message info object for winston.
     * @param {object[]} metadata The metadata.
     * @return {object} The wrapped metadata.
     * @private
     */
    _wrapMetadataInObject(metadata) {
        if (!metadata || metadata.length === 0) {
            return {};
        }

        return {
            metadata: metadata.length === 1 ? metadata[0] : metadata
        };
    }

    /**
     * Calculate the common/maximum logging level based on the transports.
     * @param {object[]} transports The array of transports.
     * @return {number} The common/maximum logging level;
     * @private
     */
    _calculateMaximumLoggingLevel(transports) {
        if (transports.length === 0) {
            return LoggingLevels.debug;
        }

        return Math.max(...transports
            .map(transport => transport.level)
            .map(level => LoggingLevels[level] || LoggingLevels.debug)
        );
    }

    /**
     * Load the Winston formats based on the Caliper configuration.
     * @param {object[]} transports The configured Winston transports.
     * @return {object[]} The configured Winston formats.
     * @private
     */
    _loadConfiguredFormats(transports) {
        // NOTES:
        // 1) The format (sub-)keys are queried directly (i.e., not using the "logging.formats" root key),
        //    so the user can easily override them
        // 2) The formats are applied in the following order: drop, timestamp, label, json,
        //    if not json, then padding, align, attribute format, colorize, message format
        const formats = [];

        // mandatory format for dropping unnecessary messages
        const maximumLoggingLevel = this._calculateMaximumLoggingLevel(transports);
        formats.push(new Drop(maximumLoggingLevel));

        this._addTimestampFormatIfConfigured(formats);
        this._addLabelFormatIfConfigured(formats);
        if (this._addJsonFormatIfConfigured(formats)) {
            // return now, since the other formats are mutually exclusive with the JSON format
            return formats;
        }

        this._addPaddingFormatIfConfigured(formats);
        this._addAlignFormatIfConfigured(formats);
        this._addAttributeFormatterFormatIfConfigured(formats);
        this._addColorizeFormatIfConfigured(formats);

        // // mandatory format for final message structure
        const messageTemplate = Config.get(Config.keys.Logging.Template, DefaultMessageTemplate);
        formats.push(new MessageFormat(messageTemplate));

        return formats;
    }

    /**
     * Adds the timestamp format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @private
     */
    _addTimestampFormatIfConfigured(formats) {
        const timestamp = Config.get(Config.keys.Logging.Formats.Timestamp);
        if (typeof timestamp === 'string') {
            let opts = {
                format: timestamp
            };
            formats.push(winston.format.timestamp(opts));
        }
    }

    /**
     * Adds the label format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @private
     */
    _addLabelFormatIfConfigured(formats) {
        const label = Config.get(Config.keys.Logging.Formats.Label);
        if (typeof label === 'string') {
            let opts = {
                label: label,
                message: false
            };
            formats.push(winston.format.label(opts));
        }
    }

    /**
     * Adds the JSON format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @return {boolean} True, if the format was added. Otherwise false.
     * @private
     */
    _addJsonFormatIfConfigured(formats) {
        const json = Config.get(Config.keys.Logging.Formats.JsonRoot);
        if (typeof json !== 'object') {
            return false;
        }

        let opts = {
            space: Config.get(Config.keys.Logging.Formats.Json.Space, 0)
        };
        formats.push(winston.format.json(opts));
        return true;
    }

    /**
     * Adds the padding format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @private
     */
    _addPaddingFormatIfConfigured(formats) {
        const pad = Config.get(Config.keys.Logging.Formats.Pad);
        if (pad === true) {
            formats.push(new PadLevel());
        }
    }

    /**
     * Adds the align format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @private
     */
    _addAlignFormatIfConfigured(formats) {
        const align = Config.get(Config.keys.Logging.Formats.Align);
        if (align === true) {
            formats.push(winston.format.align());
        }
    }

    /**
     * Adds the attribute formatter format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @private
     */
    _addAttributeFormatterFormatIfConfigured(formats) {
        const attributeFormat = Config.get(Config.keys.Logging.Formats.AttributeFormatRoot);
        if (typeof attributeFormat === 'object') {
            const options = AttributeFormatterOptions.loadFromConfiguration();
            formats.push(new AttributeFormatter(options));
        }
    }

    /**
     * Adds the colorize format if it is configured.
     * @param {object[]} formats The array of current formats.
     * @private
     */
    _addColorizeFormatIfConfigured(formats) {
        const colorize = Config.get(Config.keys.Logging.Formats.ColorizeRoot);
        if (typeof colorize === 'object') {
            const options = ColorizeOptions.loadFromConfiguration();
            formats.push(new Colorize(options));
        }
    }

    /**
     * Load the Winston transports based on the Caliper configuration.
     * @return {object[]} The configured Winston transports.
     * @private
     */
    _loadConfiguredTransports() {
        const transportSettings = WinstonTransportSetting.loadAllFromConfiguration();
        const transports = [];

        for (const setting of transportSettings.filter(transport => transport.isEnabled())) {
            switch (setting.getType()) {
            case 'console': {
                transports.push(new winston.transports.Console(setting.getOptions()));
                break;
            }
            case 'file': {
                transports.push(new winston.transports.File(setting.getOptions()));
                break;
            }
            case 'daily-rotate-file': {
                transports.push(new winston.transports.DailyRotateFile(setting.getOptions()));
                break;
            }
            default:
                throw new Error(`Unsupported target type "${setting.getType()}" for the "${setting.getName()}" logging target`);
            }
        }

        return transports;
    }
}

module.exports = WinstonLoggerAdapter;
