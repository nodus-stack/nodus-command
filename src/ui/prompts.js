import inquirer from 'inquirer';
import chalk from 'chalk';
import { slugifyWithPreview } from '../lib/slugify.js';
import fs from 'fs-extra';
import path from 'path';

function validateMountEntry(input) {
  const value = String(input || '').trim();
  if (!value) {
    return 'Mount entry is required';
  }

  const parts = value.split(':');
  if (parts.length < 2) {
    return 'Use format: <local-path>:<container-path>[:mode]';
  }

  const containerPath = parts[1];
  if (!containerPath || !containerPath.startsWith('/')) {
    return 'Container path must start with /';
  }

  return true;
}

function validatePort(input) {
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Please enter a valid port (1-65535)';
  }

  return true;
}

export async function promptProjectInit(cliOptions = {}) {
  console.log(chalk.bold('\n🚀 Initialize NodusCommand Project\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      validate: (input) => {
        if (!input || input.trim() === '') {
          return 'Project name is required';
        }
        return true;
      },
      filter: (input) => input.trim()
    }
  ]);

  // Show slug preview
  const slugInfo = slugifyWithPreview(answers.projectName);
  console.log(chalk.gray(`  Domain will be: ${slugInfo.domain}`));

  const domainAnswer = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'Domain:',
      default: slugInfo.domain,
      validate: (input) => {
        if (!input.endsWith('.localhost')) {
          return 'Domain must end with .localhost';
        }
        return true;
      }
    }
  ]);

  const typeAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'isBlank',
      message: 'Project type:',
      choices: [
        { name: 'Blank project', value: true },
        { name: 'Existing project', value: false }
      ]
    }
  ]);

  let wpVersion = '6.7';
  let hasWpContent = false;

  if (typeAnswer.isBlank) {
    const versionAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'wpVersion',
        message: 'WordPress version:',
        default: '6.7',
        validate: (input) => {
          if (!/^\d+\.\d+(\.\d+)?$/.test(input)) {
            return 'Please enter a valid version (e.g., 6.7 or 6.7.1)';
          }
          return true;
        }
      }
    ]);
    wpVersion = versionAnswer.wpVersion;
  } else {
    // Existing project - check for wp-content
    const wpContentPath = path.join(process.cwd(), 'wp-content');
    hasWpContent = await fs.pathExists(wpContentPath);

    if (!hasWpContent) {
      console.log(chalk.yellow('\n  ⚠️  wp-content folder not found in current directory'));
      console.log(chalk.gray('  init will continue and create a base wp-content structure after downloading WordPress core\n'));
    }

    const versionAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'wpVersion',
        message: 'WordPress version:',
        default: '6.7',
        validate: (input) => {
          if (!/^\d+\.\d+(\.\d+)?$/.test(input)) {
            return 'Please enter a valid version (e.g., 6.7 or 6.7.1)';
          }
          return true;
        }
      }
    ]);
    wpVersion = versionAnswer.wpVersion;
  }

  // Database configuration
  const dbAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'useLocalDb',
      message: 'Do you want to use local database?',
      choices: [
        { name: 'Yes (recommended)', value: true },
        { name: 'No (use remote connection)', value: false }
      ]
    }
  ]);

  let dbConfig = {};

  if (dbAnswer.useLocalDb) {
    const localDbAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'dbName',
        message: 'Database name:',
        default: 'wordpress'
      },
      {
        type: 'input',
        name: 'dbUser',
        message: 'Database user:',
        default: 'wordpress'
      },
      {
        type: 'password',
        name: 'dbPassword',
        message: 'Database password:',
        default: 'wordpress'
      }
    ]);

    dbConfig = {
      type: 'local',
      host: `${slugInfo.slug}-mysql`,  // ← AGREGA ESTA LÍNEA
      name: localDbAnswers.dbName,
      user: localDbAnswers.dbUser,
      password: localDbAnswers.dbPassword,
      rootPassword: 'root'
    };
  } else {
    const remoteDbAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'dbHost',
        message: 'Database host:',
        validate: (input) => input.trim() !== '' || 'Host is required'
      },
      {
        type: 'input',
        name: 'dbName',
        message: 'Database name:',
        validate: (input) => input.trim() !== '' || 'Database name is required'
      },
      {
        type: 'input',
        name: 'dbUser',
        message: 'Database user:',
        validate: (input) => input.trim() !== '' || 'User is required'
      },
      {
        type: 'password',
        name: 'dbPassword',
        message: 'Database password:',
        validate: (input) => input.trim() !== '' || 'Password is required'
      }
    ]);

    dbConfig = {
      type: 'remote',
      remote: {
        host: remoteDbAnswers.dbHost,
        name: remoteDbAnswers.dbName,
        user: remoteDbAnswers.dbUser,
        password: remoteDbAnswers.dbPassword
      },
      name: remoteDbAnswers.dbName,
      user: remoteDbAnswers.dbUser,
      password: remoteDbAnswers.dbPassword
    };
  }

  // SSH configuration
  const sshAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupSsh',
      message: 'Do you want to set up SSH connection? (Required for \'pull\' and \'push\' commands)',
      default: false
    }
  ]);

  let sshConfig = null;

  if (sshAnswer.setupSsh) {
    const sshAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'SSH Host:',
        validate: (input) => input.trim() !== '' || 'Host is required'
      },
      {
        type: 'input',
        name: 'user',
        message: 'SSH User:',
        validate: (input) => input.trim() !== '' || 'User is required'
      },
      {
        type: 'input',
        name: 'port',
        message: 'SSH Port:',
        validate: (input) => input.trim() !== '' || 'Port is required'
      },
      {
        type: 'list',
        name: 'authType',
        message: 'Authentication type:',
        choices: [
          { name: 'SSH Key file', value: 'key' },
          { name: 'Password', value: 'password' }
        ]
      },
      {
        type: 'input',
        name: 'keyFile',
        message: 'SSH Key file path:',
        default: path.join(process.env.HOME || process.env.USERPROFILE, '.ssh', 'id_rsa'),
        when: (answers) => answers.authType === 'key',
        validate: async (input) => {
          if (!input.trim()) return 'Key file path is required';
          const exists = await fs.pathExists(input);
          if (!exists) return `Key file not found: ${input}`;
          return true;
        }
      },
      {
        type: 'password',
        name: 'password',
        message: 'SSH Password:',
        when: (answers) => answers.authType === 'password',
        validate: (input) => input.trim() !== '' || 'Password is required'
      },
      {
        type: 'input',
        name: 'remotePath',
        message: 'Remote root path:',
        default: '/var/www/html',
        validate: (input) => input.trim() !== '' || 'Remote path is required'
      }
    ]);

    sshConfig = {
      host: sshAnswers.host,
      user: sshAnswers.user,
      port: sshAnswers.port,
      authType: sshAnswers.authType,
      keyFile: sshAnswers.authType === 'key' ? sshAnswers.keyFile : undefined,
      password: sshAnswers.authType === 'password' ? sshAnswers.password : undefined,
      remotePath: sshAnswers.remotePath
    };

    // If using remote DB, ask for remote DB credentials for dump
    if (dbAnswer.useLocalDb) {
      console.log(chalk.cyan('\n  Remote database configuration (for pull command):'));

      const remoteDbAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'dbHost',
          message: 'Remote DB host:',
          default: 'localhost'
        },
        {
          type: 'input',
          name: 'dbName',
          message: 'Remote DB name:',
          validate: (input) => input.trim() !== '' || 'Database name is required'
        },
        {
          type: 'input',
          name: 'dbUser',
          message: 'Remote DB user:',
          validate: (input) => input.trim() !== '' || 'User is required'
        },
        {
          type: 'password',
          name: 'dbPassword',
          message: 'Remote DB password:',
          validate: (input) => input.trim() !== '' || 'Password is required'
        }
      ]);

      sshConfig.database = {
        host: remoteDbAnswers.dbHost,
        name: remoteDbAnswers.dbName,
        user: remoteDbAnswers.dbUser,
        password: remoteDbAnswers.dbPassword
      };
    }
  }

  const customMounts = [];
  const cliMounts = Array.isArray(cliOptions.mounts) ? cliOptions.mounts : [];

  const portsAnswer = await inquirer.prompt([
    {
      type: 'input',
      name: 'localApachePort',
      message: 'Local Apache (HTTP) port:',
      default: '8080',
      validate: validatePort
    },
    {
      type: 'input',
      name: 'localMysqlPort',
      message: 'Local MySQL port:',
      default: '3306',
      validate: validatePort
    }
  ]);

  if (cliMounts.length > 0) {
    for (const mountEntry of cliMounts) {
      const validationResult = validateMountEntry(mountEntry);
      if (validationResult !== true) {
        throw new Error(`Invalid --mount value "${mountEntry}": ${validationResult}`);
      }

      customMounts.push(String(mountEntry).trim());
    }
  } else {
    const mountsAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupCustomMounts',
        message: 'Do you want to add custom bind mounts to docker-compose?',
        default: false
      }
    ]);

    if (mountsAnswer.setupCustomMounts) {
      let addMoreMounts = true;

      while (addMoreMounts) {
        const mountAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'mount',
            message: 'Mount entry (<local-path>:<container-path>[:mode]):',
            default: '/home/jesusuzcategui/WorkspacePHP/Nodus-Extension-Template:/var/www/html/wp-content/plugins/nodus-extension-template:z',
            validate: validateMountEntry,
            filter: (input) => String(input).trim()
          }
        ]);

        customMounts.push(mountAnswer.mount);

        const continueAnswer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'addMore',
            message: 'Add another mount?',
            default: false
          }
        ]);

        addMoreMounts = continueAnswer.addMore;
      }
    }
  }

  const localHttpsAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'localHttps',
      message: 'Enable local HTTPS (self-signed certificate)?',
      default: false
    }
  ]);

  let localHttpsPort = 8443;
  if (localHttpsAnswer.localHttps) {
    const localHttpsPortAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'localHttpsPort',
        message: 'Local HTTPS port:',
        default: '8443',
        validate: validatePort
      }
    ]);

    localHttpsPort = Number(localHttpsPortAnswer.localHttpsPort);
  }

  const hostsAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'autoManageHosts',
      message: 'Auto-manage hosts entry for your .localhost domain when running "noduscm up"?',
      default: true
    }
  ]);

  return {
    projectName: answers.projectName,
    slug: slugInfo.slug,
    domain: domainAnswer.domain,
    isBlank: typeAnswer.isBlank,
    wpVersion,
    hasWpContent,
    database: dbConfig,
    ssh: sshConfig,
    mounts: customMounts,
    localApachePort: Number(portsAnswer.localApachePort),
    localMysqlPort: Number(portsAnswer.localMysqlPort),
    localHttps: localHttpsAnswer.localHttps,
    localHttpsPort,
    autoManageHosts: hostsAnswer.autoManageHosts
  };
}

export async function confirmRemove(projectName) {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.red(`Are you sure you want to remove "${projectName}"? This will delete all containers and volumes.`),
      default: false
    }
  ]);

  return answer.confirm;
}

export async function selectBackup(backups) {
  if (backups.length === 0) {
    console.log(chalk.yellow('\n  No backups found\n'));
    return null;
  }

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'backup',
      message: 'Select backup to restore:',
      choices: backups.map(b => ({
        name: `${b.date} - ${b.size}`,
        value: b.file
      }))
    }
  ]);

  return answer.backup;
}