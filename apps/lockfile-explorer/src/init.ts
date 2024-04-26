// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// This function will read the current directory and try to figure out if it's a rush project or regular pnpm workspace
// Currently it will throw error if neither can be determined

import { FileSystem, JsonFile, Path } from '@rushstack/node-core-library';
import {
  type IRushConfigurationJson,
  RushConfiguration
} from '@microsoft/rush-lib/lib/api/RushConfiguration';
import type { Subspace } from '@microsoft/rush-lib/lib/api/Subspace';
import path from 'path';

import { type IAppState, type IRushProjectDetails, ProjectType } from './state';

export const init = (options: {
  lockfileExplorerProjectRoot: string;
  appVersion: string;
  debugMode: boolean;
}): IAppState => {
  const { lockfileExplorerProjectRoot, appVersion, debugMode } = options;
  const currDir = process.cwd();

  let subspaceName: string = 'default';

  if (process.argv.indexOf('--subspace') >= 0) {
    if (process.argv[2] !== '--subspace') {
      throw new Error(
        'If you want to specify a subspace, you should place "--subspace <subspace_name>" immediately after the "lockfile-explorer" command'
      );
    }

    subspaceName = process.argv[3];
  }

  let appState: IAppState | undefined;
  let currExploredDir = Path.convertToSlashes(currDir);
  while (currExploredDir.includes('/')) {
    // Look for a rush.json [rush project] or pnpm-lock.yaml file [regular pnpm workspace]
    const rushJsonPath: string = path.join(currExploredDir, 'rush.json');
    const pnpmLockPath: string = path.join(currExploredDir, 'pnpm-lock.yaml');
    if (FileSystem.exists(rushJsonPath)) {
      console.log('Found a Rush workspace: ', rushJsonPath);
      // Load the rush projects
      const rushJson: IRushConfigurationJson = JsonFile.load(rushJsonPath);
      const projectsByProjectFolder: Map<string, IRushProjectDetails> = new Map();
      for (const project of rushJson.projects) {
        projectsByProjectFolder.set(project.projectFolder, {
          projectName: project.packageName,
          projectFolder: project.projectFolder
        });
      }

      const rushConfiguration: RushConfiguration = RushConfiguration.tryLoadFromDefaultLocation()!;
      const subspace: Subspace = rushConfiguration.getSubspace(subspaceName);
      const workspaceFolder: string = subspace.getSubspaceTempFolder();

      appState = {
        currDir,
        appVersion,
        debugMode,
        lockfileExplorerProjectRoot,
        projectType: ProjectType.RUSH_PROJECT,
        pnpmLockfileLocation: path.resolve(workspaceFolder, 'pnpm-lock.yaml'),
        pnpmfileLocation: path.resolve(workspaceFolder, '.pnpmfile.cjs'),
        projectRoot: currExploredDir,
        rush: {
          rushJsonPath,
          projectsByProjectFolder
        },
        subspaceName
      };
      break;
    } else if (FileSystem.exists(pnpmLockPath)) {
      appState = {
        currDir,
        appVersion,
        debugMode,
        lockfileExplorerProjectRoot,
        projectType: ProjectType.PNPM_WORKSPACE,
        pnpmLockfileLocation: path.resolve(currExploredDir, 'pnpm-lock.yaml'),
        pnpmfileLocation: path.resolve(currExploredDir, '.pnpmfile.cjs'),
        projectRoot: currExploredDir
      };

      break;
    }

    currExploredDir = currExploredDir.substring(0, currExploredDir.lastIndexOf('/'));
  }

  if (!appState) {
    throw new Error('Could not find a Rush or PNPM workspace!');
  }

  return appState;
};
