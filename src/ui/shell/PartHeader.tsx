// A modal group's header doubling as the switch for that part of the operation:
// used by the dialogs that apply or export a chosen subset (TJA import, server
// bundle export). A part that cannot be acted on at all — a demo start with no
// bank to write it into, a dani file that was never opened — is disabled and
// reads as unchecked without forgetting the user's preference.

import { useT } from '../../i18n';

interface PartHeaderProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** False when this part cannot be acted on at all — reads as unchecked. */
  available?: boolean;
  /** True only while the operation runs: no toggling, but the choice still shows. */
  locked?: boolean;
}

export function PartHeader({
  label, checked, onChange, available = true, locked = false,
}: PartHeaderProps) {
  const t = useT();
  const on = checked && available;
  return (
    <label className={`tk-modal-grouphd tk-parthd tk-check${available ? '' : ' is-disabled'}`}>
      <input
        type="checkbox"
        checked={on}
        disabled={locked || !available}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
      {!on && <span className="tk-skiptag">{t('common.skipped')}</span>}
    </label>
  );
}
