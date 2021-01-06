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

const DefaultColorizeAttribute = false;

/**
 * Class representing the options for the colorize winston format.
 */
class ColorizeOptions {
    /**
     * Initializes a new instance.
     */
    constructor() {
        this.colorizeAll = DefaultColorizeAttribute;
        this.colorizeAttribute = {
            timestamp: DefaultColorizeAttribute,
            label: DefaultColorizeAttribute,
            level: true,
            module: DefaultColorizeAttribute,
            message: DefaultColorizeAttribute,
            metadata: DefaultColorizeAttribute,
        };

        this.levelColors = {
            info: ['green'],
            error: ['red'],
            warn: ['yellow'],
            debug: ['grey'],
        };
    }

    /**
     * Indicates whether the attribute should be colorized or not.
     * @param {string} attributeName The name of the attribute.
     * @return {boolean} True, if the attribute should be colorized. Otherwise false.
     */
    shouldColorizeAttribute(attributeName) {
        return this.colorizeAll || !!this.colorizeAttribute[attributeName];
    }

    /**
     * Get the configured colors for the given level.
     * @param {string} level The log level.
     * @return {string[]} The colors to use for the level.
     */
    getColorsForLevel(level) {
        return this.levelColors[level] || [];
    }

    /**
     * Set whether all attributes should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeAll(shouldColorize) {
        this.colorizeAll = shouldColorize;
    }

    /**
     * Set whether the "timestamp" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeTimestamp(shouldColorize) {
        this.colorizeAttribute.timestamp = shouldColorize;
    }

    /**
     * Set whether the "label" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeLabel(shouldColorize) {
        this.colorizeAttribute.label = shouldColorize;
    }

    /**
     * Set whether the "level" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeLevel(shouldColorize) {
        this.colorizeAttribute.level = shouldColorize;
    }

    /**
     * Set whether the "module" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeModule(shouldColorize) {
        this.colorizeAttribute.module = shouldColorize;
    }

    /**
     * Set whether the "message" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeMessage(shouldColorize) {
        this.colorizeAttribute.message = shouldColorize;
    }

    /**
     * Set whether the "metadata" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeMetadata(shouldColorize) {
        this.colorizeAttribute.metadata = shouldColorize;
    }

    /**
     * Set the colors to use for the "info" level
     * @param {string[]} colors The array of colors to use.
     */
    setInfoLevelColors(colors) {
        this.levelColors.info = colors;
    }

    /**
     * Set the colors to use for the "error" level
     * @param {string[]} colors The array of colors to use.
     */
    setErrorLevelColors(colors) {
        this.levelColors.error = colors;
    }

    /**
     * Set the colors to use for the "warn" level
     * @param {string[]} colors The array of colors to use.
     */
    setWarningLevelColors(colors) {
        this.levelColors.warn = colors;
    }

    /**
     * Set the colors to use for the "debug" level
     * @param {string[]} colors The array of colors to use.
     */
    setDebugLevelColors(colors) {
        this.levelColors.debug = colors;
    }

    /**
     * Creates a new instance based on the Caliper configuration.
     * @return {ColorizeOptions} The new instance.
     */
    static loadFromConfiguration() {
        const keys = Config.keys.Logging.Formats.Colorize;
        const options = new ColorizeOptions();

        options.setColorizeAll(Config.get(keys.All));
        options.setColorizeTimestamp(Config.get(keys.Timestamp));
        options.setColorizeLabel(Config.get(keys.Label));
        options.setColorizeLevel(Config.get(keys.Level));
        options.setColorizeModule(Config.get(keys.Module));
        options.setColorizeMessage(Config.get(keys.Message));
        options.setColorizeMetadata(Config.get(keys.Metadata));

        options.setInfoLevelColors(Config.get(keys.Colors.Info).split(' '));
        options.setErrorLevelColors(Config.get(keys.Colors.Error).split(' '));
        options.setWarningLevelColors(Config.get(keys.Colors.Warn).split(' '));
        options.setDebugLevelColors(Config.get(keys.Colors.Debug).split(' '));

        return options;
    }
}

module.exports = ColorizeOptions;
