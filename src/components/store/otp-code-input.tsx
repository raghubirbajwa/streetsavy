"use client";

import { useRef } from "react";

export function OtpCodeInput({
  length = 6,
  value,
  disabled,
  onChange,
}: {
  length?: number;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  function setDigit(index: number, next: string) {
    const chars = digits.slice();
    chars[index] = next;
    onChange(chars.join("").slice(0, length));
  }

  function focusAt(index: number) {
    refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  }

  return (
    <div className="store-account-otp" role="group" aria-label="Verification code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => { refs.current[index] = node; }}
          className="store-account-otp-digit"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Digit ${index + 1} of ${length}`}
          value={digit}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.replace(/\D/g, "").slice(-1);
            setDigit(index, next);
            if (next) focusAt(index + 1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index]) {
              setDigit(index - 1, "");
              focusAt(index - 1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              focusAt(index - 1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              focusAt(index + 1);
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
            if (!pasted) return;
            event.preventDefault();
            const filled = `${value.slice(0, index)}${pasted}`.replace(/\D/g, "").slice(0, length);
            onChange(filled);
            focusAt(Math.min(length - 1, filled.length));
          }}
        />
      ))}
    </div>
  );
}
