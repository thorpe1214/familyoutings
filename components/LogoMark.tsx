export default function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      {/* Pin */}
      <path
        d="M16 29c6-6.5 9-11 9-15a9 9 0 1 0-18 0c0 4 3 8.5 9 15z"
        fill="#14B8A6"
        opacity="0.15"
      />
      <path
        d="M16 29c6-6.5 9-11 9-15a9 9 0 1 0-18 0c0 4 3 8.5 9 15z"
        stroke="#14B8A6"
        strokeWidth="1.5"
      />
      {/* Family (two heads + shoulders, centered) */}
      <circle cx="12.25" cy="13.25" r="1.75" fill="#0F766E" />
      <circle cx="19.75" cy="13.25" r="1.75" fill="#0F766E" />
      <path
        d="M10.5 18.5c1.2-1.4 2.8-2.1 5.5-2.1s4.3.7 5.5 2.1"
        stroke="#0F766E"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
