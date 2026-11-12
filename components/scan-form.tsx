"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type ScanMode, type ScanRequest, scanRequestSchema } from "@/lib/scanner/validation";

const MODE_OPTIONS: { value: ScanMode; label: string }[] = [
  { value: "site", label: "Site" },
  { value: "repo", label: "Repo" },
  { value: "both", label: "Both" },
];

export function ScanForm() {
  const router = useRouter();
  const uid = useId();
  const modeLabelId = `${uid}-mode-label`;
  const siteUrlId = `${uid}-site-url`;
  const siteUrlErrorId = `${uid}-site-url-error`;
  const repoUrlId = `${uid}-repo-url`;
  const repoUrlErrorId = `${uid}-repo-url-error`;
  const ownershipId = `${uid}-accepted-ownership`;
  const ownershipLabelId = `${uid}-accepted-ownership-label`;
  const ownershipErrorId = `${uid}-accepted-ownership-error`;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<ScanRequest>({
    resolver: zodResolver(scanRequestSchema),
    defaultValues: {
      mode: "site",
      siteUrl: "",
      repoUrl: "",
      acceptedOwnership: false,
    },
  });

  const mode = watch("mode");
  const showSite = mode !== "repo";
  const showRepo = mode !== "site";

  async function onSubmit(values: ScanRequest) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (response.status === 201) {
        const { id } = (await response.json()) as { id: string };
        router.push(`/scan/${id}`);
        return;
      }
      if (response.status === 429) {
        setSubmitError("Too many scans from your network. Please wait and try again.");
      } else if (response.status === 503) {
        setSubmitError("The scan service is temporarily unavailable. Please try again later.");
      } else {
        setSubmitError("Something went wrong. Please try again.");
      }
    } catch {
      setSubmitError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="w-full">
      <div className="flex flex-col gap-4">
        <div>
          <span id={modeLabelId} className="mb-2 block text-sm font-medium text-[var(--ink)]">
            What do you want to scan?
          </span>
          <Controller
            name="mode"
            control={control}
            render={({ field }) => (
              <ToggleGroup
                type="single"
                value={field.value}
                onValueChange={(value) => {
                  if (value) {
                    field.onChange(value as ScanMode);
                  }
                }}
                aria-labelledby={modeLabelId}
              >
                {MODE_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          />
        </div>

        {showSite ? (
          <div>
            <Label htmlFor={siteUrlId}>Site URL</Label>
            <Input
              id={siteUrlId}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://your-app.com"
              className="mt-1.5 font-mono"
              aria-invalid={Boolean(errors.siteUrl)}
              aria-describedby={errors.siteUrl ? siteUrlErrorId : undefined}
              {...register("siteUrl")}
            />
            {errors.siteUrl ? (
              <p id={siteUrlErrorId} role="alert" className="mt-1.5 text-sm text-[var(--critical)]">
                {errors.siteUrl.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {showRepo ? (
          <div>
            <Label htmlFor={repoUrlId}>GitHub repo URL</Label>
            <Input
              id={repoUrlId}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://github.com/owner/repo"
              className="mt-1.5 font-mono"
              aria-invalid={Boolean(errors.repoUrl)}
              aria-describedby={errors.repoUrl ? repoUrlErrorId : undefined}
              {...register("repoUrl")}
            />
            {errors.repoUrl ? (
              <p id={repoUrlErrorId} role="alert" className="mt-1.5 text-sm text-[var(--critical)]">
                {errors.repoUrl.message}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <Button type="submit" size="lg" disabled={isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? "Starting…" : "Run pre-flight"}
          </Button>
        </div>

        <div className="flex items-start gap-3">
          <Controller
            name="acceptedOwnership"
            control={control}
            render={({ field }) => (
              <Checkbox
                id={ownershipId}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                aria-invalid={Boolean(errors.acceptedOwnership)}
                aria-labelledby={ownershipLabelId}
                aria-describedby={errors.acceptedOwnership ? ownershipErrorId : undefined}
                className="mt-0.5"
              />
            )}
          />
          <div>
            <Label id={ownershipLabelId} htmlFor={ownershipId} className="cursor-pointer">
              I own this site or repo, or have permission to scan it.
            </Label>
            {errors.acceptedOwnership ? (
              <p id={ownershipErrorId} role="alert" className="mt-1 text-sm text-[var(--critical)]">
                {errors.acceptedOwnership.message}
              </p>
            ) : null}
          </div>
        </div>

        {submitError ? (
          <p role="alert" className="text-sm text-[var(--critical)]">
            {submitError}
          </p>
        ) : null}
      </div>
    </form>
  );
}
