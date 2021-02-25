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

const DefaultColorize = false;

/**
 * Class representing the options for the colorize winston format.
 */
class ColorizeOptions {
    /**
     * Initializes a new instance.
     */
    constructor() {
        this.colorizeAll = DefaultColorize;
        this.colorizeAttribute = {
            timestamp: DefaultColorize,
            label: DefaultColorize,
            level: true,
            module: DefaultColorize,
            message: DefaultColorize,
            metadata: DefaultColorize,
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
        if (attributeName === undefined) {
            return false;
        }

        return this.colorizeAll || !!this.colorizeAttribute[attributeName];
    }

    /**
     * Get the configured colors for the given level.
     * @param {string} level The log level.
     * @return {string[]} The colors to use for the level.
     */
    getColorsForLevel(level) {
        if (level === undefined) {
            return [];
        }

        return this.levelColors[level] || [];
    }

    /**
     * Set whether all attributes should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeAll(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAll = shouldColorize;
    }

    /**
     * Set whether the "timestamp" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeTimestamp(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAttribute.timestamp = shouldColorize;
    }

    /**
     * Set whether the "label" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeLabel(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAttribute.label = shouldColorize;
    }

    /**
     * Set whether the "level" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeLevel(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAttribute.level = shouldColorize;
    }

    /**
     * Set whether the "module" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeModule(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAttribute.module = shouldColorize;
    }

    /**
     * Set whether the "message" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeMessage(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAttribute.message = shouldColorize;
    }

    /**
     * Set whether the "metadata" attribute should be colorized
     * @param {boolean} shouldColorize Indicates whether to colorize or not.
     */
    setColorizeMetadata(shouldColorize) {
        this._assertAttributeShouldColorizeParameter(shouldColorize);
        this.colorizeAttribute.metadata = shouldColorize;
    }

    /**
     * Assert that the given parameter value is a boolean value.
     * @param {boolean} shouldColorize The parameter value.
     * @private
     */
    _assertAttributeShouldColorizeParameter(shouldColorize) {
        if (shouldColorize === undefined) {
            throw new Error('The parameter "shouldColorize" is undefined');
        }

        if (typeof shouldColorize !== 'boolean') {
            throw new Error('The parameter "shouldColorize" is not a boolean value');
        }
    }

    /**
     * Set the colors to use for the "info" level
     * @param {string[]} colors The array of colors to use.
     */
    setInfoLevelColors(colors) {
        this._assertLevelColorsParameter(colors);
        this.levelColors.info = colors;
    }

    /**
     * Set the colors to use for the "error" level
     * @param {string[]} colors The array of colors to use.
     */
    setErrorLevelColors(colors) {
        this._assertLevelColorsParameter(colors);
        this.levelColors.error = colors;
    }

    /**
     * Set the colors to use for the "warn" level
     * @param {string[]} colors The array of colors to use.
     */
    setWarningLevelColors(colors) {
        this._assertLevelColorsParameter(colors);
        this.levelColors.warn = colors;
    }

    /**
     * Set the colors to use for the "debug" level
     * @param {string[]} colors The array of colors to use.
     */
    setDebugLevelColors(colors) {
        this._assertLevelColorsParameter(colors);
        this.levelColors.debug = colors;
    }

    /**
     * Assert that the given parameter value is a string array.
     * @param {string[]} colors The parameter value.
     * @private
     */
    _assertLevelColorsParameter(colors) {
        if (colors === undefined) {
            throw new Error('The parameter "colors" is undefined');
        }

        if (Array.isArray(colors)) {
            throw new Error('The parameter "colors" is not an array');
        }

        if (colors.some(value => typeof value !== 'string')) {
            throw new Error('The parameter "colors" array contains non-string entries');
        }
    }

    /**
     * Creates a new instance based on the Caliper configuration.
     * @return {ColorizeOptions} The new instance.
     */
    static loadFromConfiguration() {
        const keys = Config.keys.Logging.Formats.Colorize;
        const options = new ColorizeOptions();

        options.setColorizeAll(Config.get(keys.All, DefaultColorize));
        options.setColorizeTimestamp(Config.get(keys.Timestamp, DefaultColorize));
        options.setColorizeLabel(Config.get(keys.Label, DefaultColorize));
        options.setColorizeLevel(Config.get(keys.Level, true));
        options.setColorizeModule(Config.get(keys.Module, DefaultColorize));
        options.setColorizeMessage(Config.get(keys.Message, DefaultColorize));
        options.setColorizeMetadata(Config.get(keys.Metadata, DefaultColorize));

        const infoLevelColors = Config.get(keys.Colors.Info, 'green');
        const errorLevelColors = Config.get(keys.Colors.Error, 'red');
        const warningLevelColors = Config.get(keys.Colors.Warn, 'yellow');
        const debugLevelColors = Config.get(keys.Colors.Debug, 'grey');

        options.setInfoLevelColors(infoLevelColors.split(' '));
        options.setErrorLevelColors(errorLevelColors.split(' '));
        options.setWarningLevelColors(warningLevelColors.split(' '));
        options.setDebugLevelColors(debugLevelColors.split(' '));

        return options;
    }
}

module.exports = ColorizeOptions;
