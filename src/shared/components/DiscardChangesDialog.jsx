import ConfirmDialog from '../../components/ConfirmDialog';
import { DISCARD_TITLE, DISCARD_CONSEQUENCE } from '../utils/dirtyGuard';

/** The in-app "Discard unsaved changes?" prompt used by the dirty guard. */
export default function DiscardChangesDialog({ open, onDiscard, onKeep, consequence }) {
  return (
    <ConfirmDialog
      open={open}
      title={DISCARD_TITLE}
      consequence={consequence || DISCARD_CONSEQUENCE}
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => onDiscard?.()}
      onCancel={() => onKeep?.()}
    />
  );
}
