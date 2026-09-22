import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import QRCode from 'qrcode';
import { useStore } from '../state/store.js';
import { accountPublicKeyFromHex, deriveExternalAddress } from '../crypto/derive.js';

/** Receive page: address + QR (plan §3 Op 4). Placeholder for M0. */
export function Receive(): React.ReactElement {
  const { activeWallet, network } = useStore();
  const [receiverAddr, setReceiverAddr] = useState<string | null>(null);
  const [qrCodeAddress, setQrCodeAddress] = useState<string | null>(null);

  useEffect(() => {
    if (activeWallet == null) return;

    const accPubkey = accountPublicKeyFromHex(activeWallet.accountPubKey);
    const receiveAddress = deriveExternalAddress(accPubkey, 0, network);
    setReceiverAddr(receiveAddress);

    void (async () => {
      const qrCodeAddress = await QRCode.toString(receiveAddress, { type: 'terminal' });

      setQrCodeAddress(qrCodeAddress);
    })();
  }, [activeWallet, network]);

  if (activeWallet == null) {
    return (
      <Box flexDirection="column">
        <Text bold>Receive</Text>
        <Text color="gray">No active wallet. Press w to choose one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text bold>Receive</Text>

      <Box marginTop={1} flexDirection="column" justifyContent="center" alignItems="center">
        <Text color="cyan">{receiverAddr}</Text>
        <Text color="gray" italic>m/1852'/1815'/0'/0/0</Text>
        <Box marginTop={1}>
          <Text>{qrCodeAddress}</Text>
        </Box>
      </Box>
    </Box>
  );
}