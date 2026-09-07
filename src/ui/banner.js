import chalk from 'chalk';
import gradient from 'gradient-string';
import figlet from 'figlet';
import boxen from 'boxen';

const LOGO_COLOR = '#5555ff';

// ASCII rendering of Logo/logo-vector-exported.svg (half-block glyphs, same brand color)
const LOGO_LINES = [
  '                                    ▄██████▄',
  '                                   ████▀▀████',
  '                                  ███▀    ▀███',
  '        ▄▄▄▄▄                     ███      ███',
  '      ████████▄                   ▀███▄▄▄▄███▀',
  '     ███▀  ▀████▄                   ▀██████▀',
  '     ███     ▀████▄                   ████',
  '     ███       ▀████▄                 ████',
  '     ███         ▀████▄               ████',
  '     ███           ▀████▄             ████',
  '     ███             ▀████▄           ████',
  '     ███      █▄       ▀████▄         ████',
  '     ███      ███▄       ▀████        ████',
  '     ███      ▀████▄       ████▄      ████',
  '     ███        ▀████▄      ▀████▄    ████',
  '     ███          ▀████▄      ▀██    ████',
  '    ▄███            ▀████▄            ████',
  '    ████              ▀████▄          ████',
  '    ████                ▀████▄        ████',
  '    ████                  ▀███▄       ████',
  '  ▄██████▄                 ▀████▄     ████',
  '▄███▀▀▀▀███▄                 ▀████▄  ▄███▀',
  '███      ███                   ▀████████▀',
  '███▄    ▄███                      ▀▀▀▀▀',
  ' ████▄▄████',
  '  ▀▀█████▀'
];

export function renderLogo() {
  return LOGO_LINES.map((line) => chalk.hex(LOGO_COLOR)(line)).join('\n');
}

export function showLogo() {
  console.log('\n' + renderLogo());
  console.log(
    '\n  ' + chalk.hex(LOGO_COLOR)('Nodus') + chalk.hex(LOGO_COLOR).bold('Command') + '\n'
  );
}

export function showBanner() {
  const logo = figlet.textSync('NodusCommand', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default'
  });

  console.log('\n' + gradient.pastel.multiline(logo));
  
  console.log(
    boxen(
      chalk.white('Modern WordPress Local Development Environment\n') +
      chalk.gray('Version 1.0.0'),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan'
      }
    )
  );

  console.log(chalk.bold('\n  Commands:\n'));
  console.log(`    ${chalk.cyan('init')}        Initialize a new WordPress project`);
  console.log(`    ${chalk.cyan('up')}          Start the WordPress project`);
  console.log(`    ${chalk.cyan('down')}        Stop the WordPress project`);
  console.log(`    ${chalk.cyan('remove')}      Remove the WordPress project`);
  console.log(`    ${chalk.cyan('pull')}        Sync from remote server (requires SSH)`);
  console.log(`    ${chalk.cyan('backup')}      Backup local database`);
  
  console.log(chalk.bold('\n  Documentation:\n'));
  console.log(`    ${chalk.gray('https://juztstack.com/docs/noduscm')}`);
  console.log('');
}