import {
  ProvablePure,
  Bool,
  CircuitString,
  DeployArgs,
  Field,
  method,
  AccountUpdate,
  PublicKey,
  UInt64,
  Permissions,
  Mina,
  TokenContract,
  AccountUpdateForest,
  Struct,
  TransactionVersion,
} from 'o1js';

export { Erc20Like, TrivialCoin };

/**
 * ERC-20-like token standard.
 * https://ethereum.org/en/developers/docs/standards/tokens/erc-20/
 *
 * Differences to ERC-20:
 * - No approvals / allowance, because zkApps don't need them and they are a security liability.
 * - `transfer()` and `transferFrom()` are collapsed into a single `transfer()` method which takes
 *    both the sender and the receiver as arguments.
 * - `transfer()` and `balanceOf()` can also take an account update as an argument.
 *   This form is needed for zkApp token accounts, where the account update has to come from a method
 *   (in order to get proof authorization), and can't be created by the token contract itself.
 * - `transfer()` doesn't return a boolean, because in the zkApp protocol,
 *   a transaction succeeds or fails in its entirety, and there is no need to handle partial failures.
 */
type Erc20Like = {
  // pure view functions which don't need @method
  name?: () => CircuitString;
  symbol?: () => CircuitString;
  decimals?: () => Field;
  totalSupply(): UInt64;
  balanceOf(owner: PublicKey | AccountUpdate): UInt64;

  // mutations which need @method
  transfer(
    from: PublicKey | AccountUpdate,
    to: PublicKey | AccountUpdate,
    value: UInt64
  ): void; // emits "Transfer" event

  // events
  events: {
    Transfer: ProvablePure<{
      from: PublicKey;
      to: PublicKey;
      value: UInt64;
    }>;
  };
};

/**
 * A simple ERC20 token
 *
 * Tokenomics:
 * The supply is constant and the entire supply is initially sent to an account controlled by the zkApp developer
 * After that, tokens can be sent around with authorization from their owner, but new ones can't be minted.
 *
 * Functionality:
 * Just enough to be swapped by the DEX contract, and be secure
 */
class TrivialCoin extends TokenContract implements Erc20Like {
  // constant supply
  SUPPLY = UInt64.from(10n ** 18n);

  deploy(args?: DeployArgs) {
    super.deploy(args);
    this.account.tokenSymbol.set('TRIV');

    // make account non-upgradable forever
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey: {
        auth: Permissions.impossible(),
        txnVersion: TransactionVersion.current(),
      },
      setPermissions: Permissions.impossible(),
      access: Permissions.proofOrSignature(),
    });
  }

  @method init() {
    super.init();

    // mint the entire supply to the token account with the same address as this contract
    let address = this.self.body.publicKey;
    let receiver = this.internal.mint({ address, amount: this.SUPPLY });

    // assert that the receiving account is new, so this can be only done once
    receiver.account.isNew.requireEquals(Bool(true));

    // pay fees for opened account
    this.balance.subInPlace(Mina.getNetworkConstants().accountCreationFee);

    // since this is the only method of this zkApp that resets the entire state, provedState: true implies
    // that this function was run. Since it can be run only once, this implies it was run exactly once
  }

  // ERC20 API
  name(): CircuitString {
    return CircuitString.fromString('TrivialCoin');
  }
  symbol(): CircuitString {
    return CircuitString.fromString('TRIV');
  }
  decimals(): Field {
    return Field(9);
  }
  totalSupply(): UInt64 {
    return this.SUPPLY;
  }
  balanceOf(owner: PublicKey | AccountUpdate): UInt64 {
    let update =
      owner instanceof PublicKey
        ? AccountUpdate.create(owner, this.deriveTokenId())
        : owner;
    this.approveAccountUpdate(update);
    return update.account.balance.getAndRequireEquals();
  }

  events = {
    Transfer: Struct({ from: PublicKey, to: PublicKey, value: UInt64 }),
  };

  // TODO: doesn't emit a Transfer event yet
  // need to make transfer() a separate method from approveBase, which does the same as
  // `transfer()` on the base contract, but also emits the event

  // implement Approvable API

  @method approveBase(forest: AccountUpdateForest) {
    this.checkZeroBalanceChange(forest);
  }
}
