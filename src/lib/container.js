import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';

export async function detectContainerEngine() {
  const spinner = ora('Detecting container engine...').start();
  
  try {
    await execa('podman', ['--version']);
    spinner.succeed(chalk.green('Container engine detected: Podman'));
    return 'podman';
  } catch {
    try {
      await execa('docker', ['--version']);
      spinner.succeed(chalk.green('Container engine detected: Docker'));
      return 'docker';
    } catch {
      spinner.fail(chalk.red('Neither Docker nor Podman found'));
      throw new Error('Please install Docker or Podman to continue');
    }
  }
}

export async function getComposeCommand(engine) {
  if (engine === 'podman') {
    // Podman 4.0+ tiene compose nativo
    return 'podman compose';
  }
  
  try {
    await execa('docker', ['compose', 'version']);
    return 'docker compose';
  } catch {
    try {
      await execa('docker-compose', ['--version']);
      return 'docker-compose';
    } catch {
      throw new Error('docker-compose is required');
    }
  }
}

export async function containerUp(engine, composeFile, options = {}) {
  const composeCmd = await getComposeCommand(engine);
  const args = composeCmd.split(' ');
  const composeArgs = [...args.slice(1), '-f', composeFile, 'up', '-d'];

  if (options.build) {
    composeArgs.push('--build');
  }
  
  await execa(args[0], composeArgs, {
    stdio: 'inherit'
  });
}

export async function containerDown(engine, composeFile) {
  const composeCmd = await getComposeCommand(engine);
  const args = composeCmd.split(' ');
  
  await execa(args[0], [...args.slice(1), '-f', composeFile, 'down'], {
    stdio: 'inherit'
  });
}

export async function containerRemove(engine, composeFile) {
  const composeCmd = await getComposeCommand(engine);
  const args = composeCmd.split(' ');
  
  await execa(args[0], [...args.slice(1), '-f', composeFile, 'down', '-v'], {
    stdio: 'inherit'
  });
}

export async function containerExec(engine, container, command, options = {}) {
  const stdio = options.stdio || 'inherit';

  const args = ['exec'];
  if (options.user) args.push('-u', options.user);
  args.push(container, 'sh', '-c', command);

  await execa(engine, args, { stdio });
}

export async function containerShell(engine, container, options = {}) {
  const user = options.user || 'webuser';

  await execa(engine, ['exec', '-u', user, '-it', container, '/bin/bash'], {
    stdio: 'inherit'
  });
}