import { useEffect, type ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { accountPublicKeyFromHex, deriveExternalAddress } from '../crypto/derive.js';
import { NoActiveWallet, PageHeading } from '../components/Page.js';
import { INFO, MUTED } from '../components/theme.js';
import { QrCode } from '../components/QrCode.js';

// Header, page heading, address (wraps to two lines on a narrow terminal),
// derivation path, footer and the margins between them.
const CHROME_ROWS = 14;

/** Receive page: address + QR (plan §3 Op 4, decision 6.10). */
export function Receive(): ReactNode {
  const { activeWallet, network, receiveAddress, setReceiveAddress } = useStore();

  useEffect(() => {
    if (activeWallet == null) return;

    const accPubkey = accountPublicKeyFromHex(activeWallet.accountPubKey);
    const next = deriveExternalAddress(accPubkey, 0, network);
    setReceiveAddress(next);
  }, [activeWallet, network, setReceiveAddress]);

  if (activeWallet == null) {
    return <NoActiveWallet title="Receive" />;
  }

  return (
    <box flexDirection="column" width="100%">
      <PageHeading title="Receive" />

      {/* flexShrink stays 0 everywhere here: when the QR does not fit, flexbox
          squeezes these rows onto one another instead of clipping. */}
      <box marginTop={1} flexDirection="column" alignItems="center">
        <text fg={INFO} flexShrink={0}>
          {receiveAddress}
        </text>
        <text fg={MUTED} flexShrink={0}>
          <i>m/1852'/1815'/0'/0/0</i>
        </text>
        {receiveAddress != null && receiveAddress !== '' && (
          <box marginTop={1} flexShrink={0}>
            <QrCode content={receiveAddress} reservedRows={CHROME_ROWS} />
          </box>
        )}
      </box>
    </box>
  );
}
