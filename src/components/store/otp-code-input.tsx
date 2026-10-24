"use client";

import { useEffect, useRef } from "react";
import "./otp-code-input.css";

export function OtpCodeInput({
  length = 6,
  value,
  disabled,
  autoFocus,
  name = "one-time-code",
  onChange,
}: {
  length?: number;
  value: string;
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");
  const caret = Math.min(value.length, length - 1);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function digitsFrom(raw: string) {
    return raw.replace(/\D/g, "").slice(0, length);
  }

  return (
    <div className="store-otp">
      <label className="store-otp-label" htmlFor="store-otp-code">Verification code</label>
      <div className="store-otp-boxes" aria-hidden="true">
        {digits.map((digit, index) => (
          <span key={index} className={index === caret ? "store-otp-box is-active" : "store-otp-box"}>{digit}</span>
        ))}
      </div>
      <input
        ref={inputRef}
        id="store-otp-code"
        className="store-otp-field"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        pattern="[0-9]*"
        maxLength={length}
        name={name}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        enterKeyHint="done"
        onChange={(event) => onChange(digitsFrom(event.target.value))}
      />
    </div>
  );
}
