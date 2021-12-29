// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';

import { JsonFile, JsonSchema, FileSystem } from '@rushstack/node-core-library';

import { RushConstants } from '../logic/RushConstants';

import type {
  CommandJson,
  ICommandLineJson,
  IPhaseJson,
  IPhasedCommandJson,
  IBulkCommandJson,
  IGlobalCommandJson,
  IFlagParameterJson,
  IChoiceParameterJson,
  IStringParameterJson
} from './CommandLineJson';
import type { RushConfigurationProject } from './RushConfigurationProject';

const EXPECTED_PHASE_NAME_PREFIX: '_phase:' = '_phase:';

export interface IShellCommandTokenContext {
  packageFolder: string;
}

export interface IPhase extends IPhaseJson {
  isSynthetic?: boolean;
  logFilenameIdentifier: string;
  getDisplayNameForProject(rushProject: RushConfigurationProject): string;
}

export interface ICommandWithParameters {
  associatedParameters: Set<Parameter>;
}
export interface IPhasedCommand extends IPhasedCommandJson, ICommandWithParameters {
  isSynthetic?: boolean;
  watchForChanges?: boolean;
  disableBuildCache?: boolean;
}

export interface IGlobalCommand extends IGlobalCommandJson, ICommandWithParameters {}

export type Command = IGlobalCommand | IPhasedCommand;

export type Parameter = IFlagParameterJson | IChoiceParameterJson | IStringParameterJson;

const DEFAULT_BUILD_COMMAND_JSON: IBulkCommandJson = {
  commandKind: RushConstants.bulkCommandKind,
  name: RushConstants.buildCommandName,
  summary: "Build all projects that haven't been built, or have changed since they were last built.",
  description:
    'This command is similar to "rush rebuild", except that "rush build" performs' +
    ' an incremental build. In other words, it only builds projects whose source files have changed' +
    ' since the last successful build. The analysis requires a Git working tree, and only considers' +
    ' source files that are tracked by Git and whose path is under the project folder. (For more details' +
    ' about this algorithm, see the documentation for the "package-deps-hash" NPM package.) The incremental' +
    ' build state is tracked in a per-project folder called ".rush/temp" which should NOT be added to Git. The' +
    ' build command is tracked by the "arguments" field in the "package-deps_build.json" file contained' +
    ' therein; a full rebuild is forced whenever the command has changed (e.g. "--production" or not).',
  enableParallelism: true,
  ignoreMissingScript: false,
  ignoreDependencyOrder: false,
  incremental: true,
  allowWarningsInSuccessfulBuild: false,
  safeForSimultaneousRushProcesses: false
};

const DEFAULT_REBUILD_COMMAND_JSON: IBulkCommandJson = {
  commandKind: RushConstants.bulkCommandKind,
  name: RushConstants.rebuildCommandName,
  summary: 'Clean and rebuild the entire set of projects.',
  description:
    'This command assumes that the package.json file for each project contains' +
    ' a "scripts" entry for "npm run build" that performs a full clean build.' +
    ' Rush invokes this script to build each project that is registered in rush.json.' +
    ' Projects are built in parallel where possible, but always respecting the dependency' +
    ' graph for locally linked projects.  The number of simultaneous processes will be' +
    ' based on the number of machine cores unless overridden by the --parallelism flag.' +
    ' (For an incremental build, see "rush build" instead of "rush rebuild".)',
  enableParallelism: true,
  ignoreMissingScript: false,
  ignoreDependencyOrder: false,
  incremental: false,
  allowWarningsInSuccessfulBuild: false,
  safeForSimultaneousRushProcesses: false
};

/**
 * Custom Commands and Options for the Rush Command Line
 */
export class CommandLineConfiguration {
  private static _jsonSchema: JsonSchema = JsonSchema.fromFile(
    path.join(__dirname, '../schemas/command-line.schema.json')
  );

  public readonly commands: Map<string, Command> = new Map<string, Command>();
  public readonly phases: Map<string, IPhase> = new Map<string, IPhase>();
  public readonly parameters: Parameter[] = [];

  /**
   * shellCommand from plugin custom command line configuration needs to be expanded with tokens
   */
  public shellCommandTokenContext: IShellCommandTokenContext | undefined;

  /**
   * These path will be prepended to the PATH environment variable
   */
  private _additionalPathFolders: string[] = [];

  /**
   * Use CommandLineConfiguration.loadFromFile()
   *
   * @internal
   */
  public constructor(commandLineJson: ICommandLineJson | undefined) {
    const commandsByPhaseName: Map<string, Set<IPhasedCommand>> = new Map();
    // This maps phase names to the names of all other phases that depend on it or are
    // dependent on it. This is used to determine which commands a phase affects, even
    // if that phase isn't explicitly listed for that command.
    const relatedPhaseSets: Map<string, Set<string>> = new Map();
    if (commandLineJson?.phases) {
      for (const phase of commandLineJson.phases) {
        if (this.phases.has(phase.name)) {
          throw new Error(
            `In ${RushConstants.commandLineFilename}, the phase "${phase.name}" is specified ` +
              'more than once.'
          );
        }

        if (phase.name.substring(0, EXPECTED_PHASE_NAME_PREFIX.length) !== EXPECTED_PHASE_NAME_PREFIX) {
          throw new Error(
            `In ${RushConstants.commandLineFilename}, the phase "${phase.name}"'s name ` +
              `does not begin with the required prefix "${EXPECTED_PHASE_NAME_PREFIX}".`
          );
        }

        if (phase.name.length <= EXPECTED_PHASE_NAME_PREFIX.length) {
          throw new Error(
            `In ${RushConstants.commandLineFilename}, the phase "${phase.name}"'s name ` +
              `must have characters after "${EXPECTED_PHASE_NAME_PREFIX}"`
          );
        }

        const phaseNameWithoutPrefix: string = phase.name.substring(EXPECTED_PHASE_NAME_PREFIX.length);
        this.phases.set(phase.name, {
          ...phase,
          logFilenameIdentifier: this._normalizeNameForLogFilenameIdentifiers(phase.name),
          getDisplayNameForProject: (rushProject: RushConfigurationProject) =>
            `${rushProject.packageName} (${phaseNameWithoutPrefix})`
        });
        commandsByPhaseName.set(phase.name, new Set<IPhasedCommand>());
      }
    }

    for (const phase of this.phases.values()) {
      if (phase.dependencies?.self) {
        for (const dependencyName of phase.dependencies.self) {
          const dependency: IPhase | undefined = this.phases.get(dependencyName);
          if (!dependency) {
            throw new Error(
              `In ${RushConstants.commandLineFilename}, in the phase "${phase.name}", the self ` +
                `dependency phase "${dependencyName}" does not exist.`
            );
          }
        }
      }

      if (phase.dependencies?.upstream) {
        for (const dependency of phase.dependencies.upstream) {
          if (!this.phases.has(dependency)) {
            throw new Error(
              `In ${RushConstants.commandLineFilename}, in the phase "${phase.name}", ` +
                `the upstream dependency phase "${dependency}" does not exist.`
            );
          }
        }
      }

      this._checkForPhaseSelfCycles(phase);
      const relatedPhaseSet: Set<string> = new Set<string>();
      this._populateRelatedPhaseSets(phase.name, relatedPhaseSet);
      relatedPhaseSets.set(phase.name, relatedPhaseSet);
    }

    function populateCommandsForPhase(phaseName: string, command: IPhasedCommand): void {
      const populateRelatedPhaseSet: Set<string> = relatedPhaseSets.get(phaseName)!;
      for (const relatedPhaseSetIdentifier of populateRelatedPhaseSet) {
        commandsByPhaseName.get(relatedPhaseSetIdentifier)!.add(command);
      }
    }

    // A map of bulk command names to their corresponding synthetic phase identifiers
    const syntheticPhasesForTranslatedBulkCommands: Map<string, string> = new Map<string, string>();
    const translateBulkCommandToPhasedCommand: (
      command: IBulkCommandJson,
      isBuildCommand: boolean
    ) => IPhasedCommand = (command: IBulkCommandJson, isBuildCommand: boolean) => {
      const phaseName: string = command.name;
      const phaseForBulkCommand: IPhase = {
        name: phaseName,
        isSynthetic: true,
        dependencies: {
          upstream: command.ignoreDependencyOrder ? undefined : [phaseName]
        },
        ignoreMissingScript: command.ignoreMissingScript,
        allowWarningsOnSuccess: command.allowWarningsInSuccessfulBuild,
        logFilenameIdentifier: this._normalizeNameForLogFilenameIdentifiers(command.name),
        // Because this is a synthetic phase, just use the project name because there aren't any other phases
        getDisplayNameForProject: (rushProject: RushConfigurationProject) => rushProject.packageName
      };
      this.phases.set(phaseName, phaseForBulkCommand);
      syntheticPhasesForTranslatedBulkCommands.set(command.name, phaseName);
      const relatedPhaseSet: Set<string> = new Set<string>();
      this._populateRelatedPhaseSets(phaseName, relatedPhaseSet);
      relatedPhaseSets.set(phaseName, relatedPhaseSet);

      const translatedCommand: IPhasedCommand = {
        ...command,
        commandKind: 'phased',
        disableBuildCache: true,
        isSynthetic: true,
        associatedParameters: new Set<Parameter>(),
        phases: [phaseName]
      };
      commandsByPhaseName.set(phaseName, new Set<IPhasedCommand>());
      populateCommandsForPhase(phaseName, translatedCommand);
      return translatedCommand;
    };

    let buildCommandPhases: string[] | undefined;
    if (commandLineJson?.commands) {
      for (const command of commandLineJson.commands) {
        if (this.commands.has(command.name)) {
          throw new Error(
            `In ${RushConstants.commandLineFilename}, the command "${command.name}" is specified ` +
              'more than once.'
          );
        }

        let normalizedCommand: Command;
        switch (command.commandKind) {
          case RushConstants.phasedCommandKind: {
            normalizedCommand = {
              ...command,
              associatedParameters: new Set<Parameter>()
            };

            for (const phaseName of normalizedCommand.phases) {
              if (!this.phases.has(phaseName)) {
                throw new Error(
                  `In ${RushConstants.commandLineFilename}, in the "phases" property of the ` +
                    `"${normalizedCommand.name}" command, the phase "${phaseName}" does not exist.`
                );
              }

              populateCommandsForPhase(phaseName, normalizedCommand);
            }

            if (normalizedCommand.skipPhasesForCommand) {
              for (const phaseName of normalizedCommand.skipPhasesForCommand) {
                if (!this.phases.has(phaseName)) {
                  throw new Error(
                    `In ${RushConstants.commandLineFilename}, in the "skipPhasesForCommand" property of the ` +
                      `"${normalizedCommand.name}" command, the phase ` +
                      `"${phaseName}" does not exist.`
                  );
                }

                populateCommandsForPhase(phaseName, normalizedCommand);
              }
            }

            break;
          }

          case RushConstants.globalCommandKind: {
            normalizedCommand = {
              ...command,
              associatedParameters: new Set<Parameter>()
            };
            break;
          }

          case RushConstants.bulkCommandKind: {
            // Translate the bulk command into a phased command
            normalizedCommand = translateBulkCommandToPhasedCommand(command, /* isBuildCommand */ false);
            break;
          }
        }

        if (
          normalizedCommand.name === RushConstants.buildCommandName ||
          normalizedCommand.name === RushConstants.rebuildCommandName
        ) {
          if (normalizedCommand.commandKind === RushConstants.globalCommandKind) {
            throw new Error(
              `${RushConstants.commandLineFilename} defines a command "${normalizedCommand.name}" using ` +
                `the command kind "${RushConstants.globalCommandKind}". This command can only be designated as a command ` +
                `kind "${RushConstants.bulkCommandKind}" or "${RushConstants.phasedCommandKind}".`
            );
          } else if (command.safeForSimultaneousRushProcesses) {
            throw new Error(
              `${RushConstants.commandLineFilename} defines a command "${normalizedCommand.name}" using ` +
                `"safeForSimultaneousRushProcesses=true". This configuration is not supported for "${normalizedCommand.name}".`
            );
          } else if (normalizedCommand.name === RushConstants.buildCommandName) {
            // Record the build command phases in case we need to construct a synthetic "rebuild" command
            buildCommandPhases = normalizedCommand.phases;
          }
        }

        this.commands.set(normalizedCommand.name, normalizedCommand);
      }
    }

    let buildCommand: Command | undefined = this.commands.get(RushConstants.buildCommandName);
    if (!buildCommand) {
      // If the build command was not specified in the config file, add the default build command
      buildCommand = translateBulkCommandToPhasedCommand(
        DEFAULT_BUILD_COMMAND_JSON,
        /* isBuildCommand */ true
      );
      buildCommand.disableBuildCache = DEFAULT_BUILD_COMMAND_JSON.disableBuildCache;
      buildCommandPhases = buildCommand.phases;
      this.commands.set(buildCommand.name, buildCommand);
    }

    if (!this.commands.has(RushConstants.rebuildCommandName)) {
      // If a rebuild command was not specified in the config file, add the default rebuild command
      if (!buildCommandPhases) {
        throw new Error(`Phases for the "${RushConstants.buildCommandName}" were not found.`);
      }

      const rebuildCommand: IPhasedCommand = {
        ...DEFAULT_REBUILD_COMMAND_JSON,
        commandKind: RushConstants.phasedCommandKind,
        isSynthetic: true,
        phases: buildCommandPhases,
        disableBuildCache: DEFAULT_REBUILD_COMMAND_JSON.disableBuildCache,
        associatedParameters: buildCommand.associatedParameters // rebuild should share build's parameters in this case
      };
      this.commands.set(rebuildCommand.name, rebuildCommand);
    }

    if (commandLineJson?.parameters) {
      function populateCommandAssociatedParametersForPhase(phaseName: string, parameter: Parameter): void {
        const commands: Set<Command> = commandsByPhaseName.get(phaseName)!;
        for (const command of commands) {
          command.associatedParameters.add(parameter);
        }
      }

      for (const parameter of commandLineJson.parameters) {
        const normalizedParameter: Parameter = {
          ...parameter,
          associatedPhases: parameter.associatedPhases ? [...parameter.associatedPhases] : [],
          associatedCommands: parameter.associatedCommands ? [...parameter.associatedCommands] : []
        };

        this.parameters.push(normalizedParameter);

        let parameterHasAssociations: boolean = false;

        // Do some basic validation
        switch (normalizedParameter.parameterKind) {
          case 'flag': {
            const addPhasesToCommandSet: Set<string> = new Set<string>();

            if (normalizedParameter.addPhasesToCommand) {
              for (const phaseName of normalizedParameter.addPhasesToCommand) {
                addPhasesToCommandSet.add(phaseName);
                const phase: IPhase | undefined = this.phases.get(phaseName);
                if (!phase || phase.isSynthetic) {
                  throw new Error(
                    `${RushConstants.commandLineFilename} defines a parameter "${normalizedParameter.longName}" ` +
                      `that lists phase "${phaseName}" in its "addPhasesToCommand" ` +
                      'property that does not exist.'
                  );
                } else {
                  populateCommandAssociatedParametersForPhase(phaseName, normalizedParameter);
                  parameterHasAssociations = true;
                }
              }
            }

            if (normalizedParameter.skipPhasesForCommand) {
              for (const phaseName of normalizedParameter.skipPhasesForCommand) {
                const phase: IPhase | undefined = this.phases.get(phaseName);
                if (!phase || phase.isSynthetic) {
                  throw new Error(
                    `${RushConstants.commandLineFilename} defines a parameter "${normalizedParameter.longName}" ` +
                      `that lists phase "${phaseName}" in its skipPhasesForCommand" ` +
                      'property that does not exist.'
                  );
                } else if (addPhasesToCommandSet.has(phaseName)) {
                  throw new Error(
                    `${RushConstants.commandLineFilename} defines a parameter "${normalizedParameter.longName}" ` +
                      `that lists phase "${phaseName}" in both its "addPhasesToCommand" ` +
                      'and "skipPhasesForCommand" properties.'
                  );
                } else {
                  populateCommandAssociatedParametersForPhase(phaseName, normalizedParameter);
                  parameterHasAssociations = true;
                }
              }
            }

            break;
          }

          case 'choice': {
            const alternativeNames: string[] = normalizedParameter.alternatives.map((x) => x.name);

            if (
              normalizedParameter.defaultValue &&
              alternativeNames.indexOf(normalizedParameter.defaultValue) < 0
            ) {
              throw new Error(
                `In ${RushConstants.commandLineFilename}, the parameter "${normalizedParameter.longName}",` +
                  ` specifies a default value "${normalizedParameter.defaultValue}"` +
                  ` which is not one of the defined alternatives: "${alternativeNames.toString()}"`
              );
            }

            break;
          }
        }

        if (normalizedParameter.associatedCommands) {
          for (let i: number = 0; i < normalizedParameter.associatedCommands.length; i++) {
            const associatedCommandName: string = normalizedParameter.associatedCommands[i];
            const syntheticPhaseName: string | undefined =
              syntheticPhasesForTranslatedBulkCommands.get(associatedCommandName);
            if (syntheticPhaseName) {
              // If this parameter was associated with a bulk command, change the association to
              // the command's synthetic phase
              normalizedParameter.associatedPhases!.push(syntheticPhaseName);
              normalizedParameter.associatedCommands.splice(i, 1);
              i--;
              populateCommandAssociatedParametersForPhase(syntheticPhaseName, normalizedParameter);
              parameterHasAssociations = true;
            } else if (!this.commands.has(associatedCommandName)) {
              throw new Error(
                `${RushConstants.commandLineFilename} defines a parameter "${normalizedParameter.longName}" ` +
                  `that is associated with a command "${associatedCommandName}" that does not exist or does ` +
                  'not support custom parameters.'
              );
            } else {
              const associatedCommand: Command = this.commands.get(associatedCommandName)!;
              associatedCommand.associatedParameters.add(normalizedParameter);
              parameterHasAssociations = true;
            }
          }
        }

        for (const associatedPhase of normalizedParameter.associatedPhases || []) {
          if (!this.phases.has(associatedPhase)) {
            throw new Error(
              `${RushConstants.commandLineFilename} defines a parameter "${normalizedParameter.longName}" ` +
                `that is associated with a phase "${associatedPhase}" that does not exist.`
            );
          } else {
            populateCommandAssociatedParametersForPhase(associatedPhase, normalizedParameter);
            parameterHasAssociations = true;
          }
        }

        if (!parameterHasAssociations) {
          throw new Error(
            `${RushConstants.commandLineFilename} defines a parameter "${normalizedParameter.longName}"` +
              ` that lists no associated commands or phases.`
          );
        }
      }
    }
  }

  private _checkForPhaseSelfCycles(phase: IPhase, checkedPhases: Set<string> = new Set<string>()): void {
    const dependencies: string[] | undefined = phase.dependencies?.self;
    if (dependencies) {
      for (const dependencyName of dependencies) {
        if (checkedPhases.has(dependencyName)) {
          const dependencyNameForError: string =
            typeof dependencyName === 'string' ? dependencyName : '<synthetic phase>';
          throw new Error(
            `In ${RushConstants.commandLineFilename}, there exists a cycle within the ` +
              `set of ${dependencyNameForError} dependencies: ${Array.from(checkedPhases).join(', ')}`
          );
        } else {
          checkedPhases.add(dependencyName);
          const dependency: IPhase | undefined = this.phases.get(dependencyName);
          if (!dependency) {
            return; // Ignore, we check for this separately
          } else {
            if (dependencies.length > 1) {
              this._checkForPhaseSelfCycles(
                dependency,
                // Clone the set of checked phases if there are multiple branches we need to check
                new Set<string>(checkedPhases)
              );
            } else {
              this._checkForPhaseSelfCycles(dependency, checkedPhases);
            }
          }
        }
      }
    }
  }

  private _populateRelatedPhaseSets(phaseName: string, relatedPhaseSet: Set<string>): void {
    if (!relatedPhaseSet.has(phaseName)) {
      relatedPhaseSet.add(phaseName);
      const phase: IPhase = this.phases.get(phaseName)!;
      if (phase.dependencies) {
        if (phase.dependencies.self) {
          for (const dependencyName of phase.dependencies.self) {
            this._populateRelatedPhaseSets(dependencyName, relatedPhaseSet);
          }
        }

        if (phase.dependencies.upstream) {
          for (const dependencyName of phase.dependencies.upstream) {
            this._populateRelatedPhaseSets(dependencyName, relatedPhaseSet);
          }
        }
      }
    }
  }

  /**
   * Loads the configuration from the specified file and applies any omitted default build
   * settings.  If the file does not exist, then an empty default instance is returned.
   * If the file contains errors, then an exception is thrown.
   */
  public static loadFromFileOrDefault(jsonFilename?: string): CommandLineConfiguration {
    let commandLineJson: ICommandLineJson | undefined = undefined;
    if (jsonFilename && FileSystem.exists(jsonFilename)) {
      commandLineJson = JsonFile.load(jsonFilename);

      // merge commands specified in command-line.json and default (re)build settings
      // Ensure both build commands are included and preserve any other commands specified
      if (commandLineJson && commandLineJson.commands) {
        for (let i: number = 0; i < commandLineJson.commands.length; i++) {
          const command: CommandJson = commandLineJson.commands[i];

          // Determine if we have a set of default parameters
          let commandDefaultDefinition: CommandJson | {} = {};
          switch (command.commandKind) {
            case RushConstants.bulkCommandKind: {
              switch (command.name) {
                case RushConstants.buildCommandName: {
                  commandDefaultDefinition = DEFAULT_BUILD_COMMAND_JSON;
                  break;
                }

                case RushConstants.rebuildCommandName: {
                  commandDefaultDefinition = DEFAULT_REBUILD_COMMAND_JSON;
                  break;
                }
              }
              break;
            }
          }

          // Merge the default parameters into the repo-specified parameters
          commandLineJson.commands[i] = {
            ...commandDefaultDefinition,
            ...command
          };
        }

        CommandLineConfiguration._jsonSchema.validateObject(commandLineJson, jsonFilename);
      }
    }

    return new CommandLineConfiguration(commandLineJson);
  }

  public get additionalPathFolders(): Readonly<string[]> {
    return this._additionalPathFolders;
  }

  public prependAdditionalPathFolder(pathFolder: string): void {
    this._additionalPathFolders.unshift(pathFolder);
  }

  private _normalizeNameForLogFilenameIdentifiers(name: string): string {
    return name.replace(/:/g, '_'); // Replace colons with underscores to be filesystem-safe
  }
}
