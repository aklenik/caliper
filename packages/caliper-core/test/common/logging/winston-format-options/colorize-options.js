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

const chai = require('chai');
const should = chai.should();
const sinon = require('sinon');
const rewire = require('rewire');

const ColorizeOptions = rewire('../../../../lib/common/logging/winston-format-options/colorize-options');
const Config = require('../../../../lib/common/config/config-util');
const ConfigStub = require('../../../../lib/common/config/config-stub');

function setConfigModule(configModule) {
    ColorizeOptions.__set__('Config', configModule);
}

function resetConfigStub() {
    ConfigStub.get.reset();
    ConfigStub.set.reset();
}

function getDefaultColorizeValue() {
    return ColorizeOptions.__get__('DefaultColorize');
}

describe('ColorizeOptions module', () => {
    describe('ColorizeOptions class', () => {
        beforeEach(() => {
            setConfigModule(ConfigStub);
            resetConfigStub();
        });

        afterEach(() => {
            resetConfigStub();
            setConfigModule(Config);
        });

        describe('#constructor', () => {
            const similarColorizeAttributes = ['timestamp', 'label', 'module', 'message', 'metadata'];

            for (const attribute of similarColorizeAttributes) {
                it(`should set ${attribute} colorization to default value`, () => {
                    // Arrange

                    // Act
                    const options = new ColorizeOptions();

                    // Assert
                    options.shouldColorizeAttribute(attribute).should.equal(getDefaultColorizeValue());
                });
            }

            it('should set level colorization by default to true', () => {
                // Arrange

                // Act
                const options = new ColorizeOptions();

                // Assert
                options.shouldColorizeAttribute('level').should.be.true;
            });
        });
    });
});
