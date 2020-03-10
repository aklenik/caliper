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

const path = require('path');
const fs = require('fs');

const packages = [
    'caliper-core',
    'caliper-burrow',
    'caliper-ethereum',
    'caliper-fabric',
    'caliper-iroha',
    'caliper-sawtooth',
    'caliper-fisco-bcos',
    'caliper-cli'
];

// impl => lib => caliper-publish
const thisPackageRoot = path.join(__dirname, '..', '..');
const packagesRoot = path.join(thisPackageRoot, '..');
const repoRoot = path.join(packagesRoot, '..');

/**
 * Utility function for overwriting the common Caliper version in the package.json files.
 * @param {string} packageJsonPath The path of the package.json file.
 * @param {string} customVersion The new version to use.
 */
function injectCustomVersion(packageJsonPath, customVersion) {
    let packageObject = require(packageJsonPath);

    // overwrite the own version
    packageObject.version = customVersion;

    // overwrite every dependency to other Caliper packages (to keep unstable builds in sync)
    for (let dep of Object.keys(packageObject.dependencies)) {
        if (dep.startsWith('@hyperledger/caliper-')) {
            packageObject.dependencies[dep] = customVersion;
        }
    }

    // serialize new content
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageObject, null, 4));
}

/**
 * Implements the docker publish command logic.
 */
class Fix {
    /**
     * Handler for the docker command invocation.
     * @async
     */
    static async handler() {
        const rootPackageJsonPath = path.join(repoRoot, 'package.json');
        let packageVersion = require(rootPackageJsonPath).version;

        for (let pkg of packages) {
            const packageDir = path.join(packagesRoot, pkg);
            injectCustomVersion(path.join(packageDir, 'package.json'), packageVersion);
        }
    }
}

module.exports = Fix;
