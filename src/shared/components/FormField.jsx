import { Children, cloneElement, isValidElement, useId } from 'react';
import FieldError from './FieldError';

/**
 * A labelled form field (P5-14): the label is tied to its control with
 * htmlFor/id from useId, and an error / hint is announced with the control
 * (aria-describedby, aria-invalid).
 *
 *   <FormField label="Quantity (kg)" required error={errors.qty} hint="Net weight">
 *     <input type="number" value={qty} onChange={…} className={INPUT} />
 *   </FormField>
 *
 * A single element child gets the id injected (an id it already has is kept).
 * For a custom control pass a render function: {(id) => <MyInput id={id} />}.
 */
export default function FormField({
  label, required = false, error, hint, children, className = '', labelClassName = 'block text-xs font-medium text-gray-600 mb-1',
}) {
  const autoId = useId();
  const child = typeof children === 'function' ? null : Children.only(children);
  const id = (isValidElement(child) && child.props.id) || autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = typeof children === 'function'
    ? children(id, { 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : cloneElement(child, {
      id,
      'aria-describedby': describedBy || child.props['aria-describedby'],
      'aria-invalid': error ? true : child.props['aria-invalid'],
      'aria-required': required || child.props['aria-required'] || undefined,
    });

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className={labelClassName}>
          {label}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
        </label>
      )}
      {control}
      {hint && <p id={hintId} className="text-[11px] text-gray-400 mt-1">{hint}</p>}
      {error && <div id={errorId} role="alert"><FieldError error={error} /></div>}
    </div>
  );
}
