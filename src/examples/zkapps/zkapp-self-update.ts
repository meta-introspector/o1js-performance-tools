/**
 * This example deploys a zkApp and then updates its verification key via proof, self-replacing the zkApp
 */
import {
  SmartContract,
  VerificationKey,
  method,
  Permissions,
  Mina,
  AccountUpdate,
  Provable,
  TransactionVersion,
} from 'o1js';

class Contract extends SmartContract {
  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey: {
        auth: Permissions.proof(),
        txnVersion: TransactionVersion.current(),
      },
    });
  }

  @method async replaceVerificationKey(verificationKey: VerificationKey) {
    this.account.verificationKey.set(verificationKey);
  }
}

class Bar extends SmartContract {
  @method async call() {
    Provable.log('Bar');
  }
}

// setup

const Local = Mina.LocalBlockchain({ proofsEnabled: true });
Mina.setActiveInstance(Local);

const contractAccount = Mina.TestAccount.random();
const contract = new Contract(contractAccount);

const [deployer] = Local.testAccounts;

// deploy first verification key

await Contract.compile();

const tx = await Mina.transaction(deployer, async () => {
  AccountUpdate.fundNewAccount(deployer);
  await contract.deploy();
});
await tx.prove();
await tx.sign([deployer.key, contractAccount.key]).send();

const fooVerificationKey =
  Mina.getAccount(contractAccount).zkapp?.verificationKey;
Provable.log('original verification key', fooVerificationKey);

// update verification key

const { verificationKey: barVerificationKey } = await Bar.compile();

const tx2 = await Mina.transaction(deployer, async () => {
  await contract.replaceVerificationKey(barVerificationKey);
});
await tx2.prove();
await tx2.sign([deployer.key]).send();

const updatedVerificationKey =
  Mina.getAccount(contractAccount).zkapp?.verificationKey;

// should be different from Foo
Provable.log('updated verification key', updatedVerificationKey);
