"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground shadow-sm hover:brightness-110 active:brightness-95",
  secondary:
    "border border-line bg-canvas text-ink hover:bg-hover active:bg-active",
  ghost:
    "text-muted hover:bg-hover hover:text-ink active:bg-active",
  danger:
    "border border-danger-line bg-danger-soft text-danger hover:brightness-[0.98]",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-[background-color,color,filter,border-color] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-xl border border-line bg-canvas shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-xl text-[11.5px] leading-5 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

const tones = {
  neutral: "bg-hover text-muted",
  info: "bg-accent-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

export type Tone = keyof typeof tones;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-[0.02em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  if (["COMPLETED", "IDLE", "PASSED"].includes(status)) return "success";
  if (["FAILED", "CANCELLED", "TIMED_OUT", "BLOCKED"].includes(status))
    return "danger";
  if (["RUNNING", "IN_PROGRESS", "CREATED"].includes(status)) return "info";
  if (["PENDING", "DISCOVERY", "QUEUED", "PAUSED"].includes(status))
    return "warning";
  return "neutral";
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-accent-soft disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] leading-5 text-ink outline-none transition placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-accent-soft disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
      {hint ? (
        <span className="block text-[10.5px] leading-4 text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11.5px] text-muted">
      <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-5 text-muted">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
