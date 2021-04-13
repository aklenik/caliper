#!/bin/bash
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# Publish the packages locally and build a local test image
cd ./packages/caliper-publish/
./publish.js verdaccio start
sleep 5s
./publish.js npm --registry http://localhost:4873
./publish.js docker --registry http://localhost:4873 --image klenik/caliper-fabric-1.4.17 --tag experimental
./publish.js verdaccio stop
./publish.js fix

docker push klenik/caliper-fabric-1.4.17:experimental
