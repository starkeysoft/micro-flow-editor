// `micro-flow-editor user …`: manage sign-in accounts from a shell, e.g. to
// reset a forgotten password. Uses the same database settings as the server.
// Passwords come from a hidden prompt, or from stdin when it isn't a terminal
// (never from the command line, where other users could see them).
import readline from 'readline';
import { initDatabase, sequelize, User, Session } from './db.js';
import { createUser, setPassword, checkUsername, AuthError } from './auth.js';

const USAGE = `Usage: micro-flow-editor user <command>

  user list                 list accounts
  user add <username>       create an account (asks for a password)
  user passwd <username>    set a new password and sign the user out everywhere
  user remove <username>    delete an account

Passwords are read from a hidden prompt, or from stdin when piped:
  printf 'new-password\\n' | micro-flow-editor user passwd admin`;

function readHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Echo nothing while the password is typed.
    rl._writeToOutput = (text) => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readStdinLine() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

async function askPassword() {
  if (!process.stdin.isTTY) return readStdinLine();
  const first = await readHidden('Password: ');
  const again = await readHidden('Repeat password: ');
  if (first !== again) throw new AuthError('The passwords don\'t match.');
  return first;
}

async function findUser(username) {
  const user = await User.findOne({ where: { username: checkUsername(username) } });
  if (!user) throw new AuthError(`No user called "${username}".`);
  return user;
}

export async function runUsersCli(args) {
  const [command, username] = args;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  await initDatabase({ attempts: 3 });
  try {
    switch (command) {
      case 'list': {
        const users = await User.findAll({ order: [['username', 'ASC']] });
        if (!users.length) console.log('No accounts yet.');
        for (const u of users) console.log(`${u.username}\tlast sign-in: ${u.last_login_at?.toISOString() ?? 'never'}`);
        return 0;
      }
      case 'add': {
        if (!username) throw new AuthError('Give a username: user add <username>');
        checkUsername(username);
        const user = await createUser(username, await askPassword());
        console.log(`Created "${user.username}".`);
        return 0;
      }
      case 'passwd': {
        const user = await findUser(username);
        await setPassword(user, await askPassword());
        await Session.destroy({ where: { user_id: user.id } });
        console.log(`Changed the password of "${user.username}" and signed them out everywhere.`);
        return 0;
      }
      case 'remove': {
        const user = await findUser(username);
        await Session.destroy({ where: { user_id: user.id } });
        await user.destroy();
        console.log(`Removed "${user.username}".`);
        return 0;
      }
      default:
        console.error(`Unknown command "${command}".\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    console.error(error instanceof AuthError ? error.message : error);
    return 1;
  } finally {
    await sequelize.close();
  }
}
