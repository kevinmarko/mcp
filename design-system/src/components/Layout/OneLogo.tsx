import React from 'react';

export interface OneLogoProps {
  /** Sizing is entirely caller-controlled, e.g. `h-24 w-auto` on an empty state, `h-11 w-auto` in a header. */
  className?: string;
}

/**
 * OneLogo is a hand-drawn inline SVG approximation of the ONE (Ocean
 * Network Express) wordmark, in brand pink — ported verbatim from the
 * report as a branding reference, not an external image asset.
 */
export function OneLogo({ className = '' }: OneLogoProps) {
  return (
    <svg viewBox="0 0 140 56" className={className} xmlns="http://www.w3.org/2000/svg" aria-label="Ocean Network Express Logo">
      <path fillRule="evenodd" clipRule="evenodd" d="M0 0h40v40H0zM10 10h20v20H10z" fill="#E5007D" />
      <path d="M50 0h10l20 28V0h10v40H80L60 12v28H50z" fill="#E5007D" />
      <path d="M100 0h40v10h-30v5h20v10h-20v5h30v10h-40z" fill="#E5007D" />
      <text x="0" y="53" fontFamily="Arial, Helvetica, sans-serif" fontWeight={900} fontSize="9.5" fill="#E5007D" textLength={140} lengthAdjust="spacing">
        OCEAN NETWORK EXPRESS
      </text>
    </svg>
  );
}
