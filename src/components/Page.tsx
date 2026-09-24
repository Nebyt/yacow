import type { ReactNode } from 'react';
import { ERROR, FG, MUTED } from './theme.js';

export interface PageHeadingProps {
  title: ReactNode;
  subtitle?: ReactNode;
}

/** Consistent page title and optional supporting line. */
export function PageHeading({ title, subtitle }: PageHeadingProps): ReactNode {
  return (
    <>
      <text fg={FG}>
        <strong>{title}</strong>
      </text>
      {subtitle != null && <text fg={MUTED}>{subtitle}</text>}
    </>
  );
}

/** Inline validation or operation error. */
export function ErrorText({ children }: { children: ReactNode }): ReactNode {
  return <text fg={ERROR}>{children}</text>;
}

/** Standard empty-wallet state used by wallet-dependent pages. */
export function NoActiveWallet({ title }: { title: string }): ReactNode {
  return (
    <box flexDirection="column">
      <PageHeading title={title} subtitle="No active wallet. Press w to choose one." />
    </box>
  );
}

/** Shared provider-fetch failure with the standard recovery hint. */
export function ChainError({ subject, error }: { subject: string; error: string }): ReactNode {
  return (
    <box flexDirection="column">
      <ErrorText>
        {subject} unavailable: {error}
      </ErrorText>
      <text fg={MUTED}>Press R to retry, or , to check your providers.</text>
    </box>
  );
}
