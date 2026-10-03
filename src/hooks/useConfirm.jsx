import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Promise-based confirmation, so a call site reads the way the `window.confirm`
 * it replaces did:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   …
 *   const ok = await confirm({ title: 'Reverse this payment?', consequence: '…', reason: 'optional' });
 *   if (!ok) return;
 *   mutate({ reason: ok.reason });
 *   …
 *   return (<>{confirmDialog}…</>);
 *
 * Resolves `false` on dismissal and `{ reason }` on confirmation. Keeping the
 * truthy/falsy shape is the point: the 27 sites being replaced all test the
 * result directly, so they convert by adding `await` rather than by being
 * restructured around a callback.
 */
export default function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setState({ ...opts, resolve });
  }), []);

  const close = useCallback((result) => {
    setState((cur) => { cur?.resolve(result); return null; });
  }, []);

  const dialog = (
    <ConfirmDialog
      {...(state || {})}
      open={!!state}
      onCancel={() => close(false)}
      onConfirm={({ reason }) => close({ reason })}
    />
  );

  return [confirm, dialog];
}
