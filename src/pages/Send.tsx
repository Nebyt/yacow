import type { ReactNode } from 'react';
import { PageHeading } from '../components/Page.js';

/** Send flow (plan §3 Op 5). Placeholder for M0. */
export function Send(): ReactNode {
  return (
    <box flexDirection="column">
      <PageHeading
        title="Send"
        subtitle="Recipient, asset/amount, review, and submit land here (M5)."
      />
    </box>
  );
}
