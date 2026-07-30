"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, FormField, Input, Select } from "@/ui";
import { CheckboxRow, FormSection } from "@/ui/form-layout";
import api from "@/lib/api/client";
import type {
  ScientistDataType,
  ScientistExperienceLevel,
  ScientistGoal,
  ScientistResearchField,
  ScientistComputePreference,
} from "@local-studio/contracts/scientist-profile";

const RESEARCH_FIELDS: Array<{ value: ScientistResearchField; label: string; hint: string }> = [
  {
    value: "biology",
    label: "Biology",
    hint: "Genetics, ecology, molecular biology, neuroscience",
  },
  {
    value: "chemistry",
    label: "Chemistry",
    hint: "Organic, inorganic, analytical, materials chemistry",
  },
  {
    value: "physics",
    label: "Physics",
    hint: "Quantum, condensed matter, astrophysics, particle physics",
  },
  {
    value: "climate",
    label: "Climate & Earth Science",
    hint: "Atmospheric, oceanographic, geological studies",
  },
  {
    value: "materials",
    label: "Materials Science",
    hint: "Nanomaterials, polymers, composites, metallurgy",
  },
  {
    value: "computer_science",
    label: "Computer Science",
    hint: "Algorithms, systems, machine learning theory",
  },
  {
    value: "social_science",
    label: "Social Science",
    hint: "Economics, psychology, sociology, political science",
  },
  {
    value: "medicine",
    label: "Medicine & Health",
    hint: "Clinical research, epidemiology, pharmacology",
  },
  {
    value: "engineering",
    label: "Engineering",
    hint: "Electrical, mechanical, civil, chemical engineering",
  },
  { value: "mathematics", label: "Mathematics", hint: "Pure and applied mathematics, statistics" },
  { value: "other", label: "Other", hint: "Interdisciplinary or other scientific field" },
];

const DATA_TYPES: Array<{ value: ScientistDataType; label: string; hint: string }> = [
  { value: "tabular", label: "Spreadsheets / Tables", hint: "CSV, Excel, database tables" },
  { value: "images", label: "Images", hint: "Microscopy, satellite, medical imaging" },
  { value: "text", label: "Text / Documents", hint: "Papers, reports, notes, literature" },
  {
    value: "time_series",
    label: "Time Series",
    hint: "Sensor readings, financial, climate records",
  },
  { value: "genomic", label: "Genomic / Sequence", hint: "DNA, RNA, protein sequences" },
  { value: "spatial", label: "Spatial / GIS", hint: "Maps, coordinates, geographic data" },
  { value: "sensor", label: "Sensor / IoT", hint: "Instrument readings, telemetry, logs" },
  { value: "audio", label: "Audio", hint: "Recordings, acoustic measurements" },
  { value: "video", label: "Video", hint: "Video recordings, animations, simulations" },
  {
    value: "graphs",
    label: "Graphs / Networks",
    hint: "Molecular graphs, social networks, knowledge graphs",
  },
  { value: "other", label: "Other", hint: "Custom or mixed data formats" },
];

const GOALS: Array<{ value: ScientistGoal; label: string; hint: string }> = [
  {
    value: "literature_review",
    label: "Literature Review",
    hint: "Search, summarize, and synthesize papers",
  },
  {
    value: "data_analysis",
    label: "Data Analysis",
    hint: "Explore, visualize, and interpret data",
  },
  {
    value: "experiment_pipeline",
    label: "Experiment Pipeline",
    hint: "Run and track experiments systematically",
  },
  { value: "model_training", label: "Model Training", hint: "Train and evaluate ML models" },
  { value: "report_writing", label: "Report Writing", hint: "Generate reports and documentation" },
  {
    value: "hypothesis_testing",
    label: "Hypothesis Testing",
    hint: "Statistical tests and significance analysis",
  },
  {
    value: "visualization",
    label: "Visualization",
    hint: "Create charts, plots, and interactive visuals",
  },
  { value: "other", label: "Other", hint: "Something else entirely" },
];

const COMPUTE_OPTIONS: Array<{
  value: ScientistComputePreference;
  label: string;
  hint: string;
}> = [
  {
    value: "local-smolvm",
    label: "Safe Sandbox (no install needed)",
    hint: "Runs Python in an isolated sandbox. Works on any laptop. No network access. Best for getting started.",
  },
  {
    value: "local-jupyter",
    label: "Full Python (requires Jupyter)",
    hint: "Uses your local Jupyter installation. Full kernel access. Best if you already have Python set up.",
  },
  {
    value: "remote",
    label: "Remote Compute",
    hint: "Run jobs on a remote cluster (requires Kubernetes). Best for large-scale experiments.",
  },
];

const EXPERIENCE_LEVELS: Array<{
  value: ScientistExperienceLevel;
  label: string;
  hint: string;
}> = [
  {
    value: "no_code",
    label: "I don't write code",
    hint: "I want the AI to write all the code for me. I'll review and approve what it does.",
  },
  {
    value: "some_code",
    label: "I write some code",
    hint: "I can read and modify Python, but I want help with complex parts.",
  },
  {
    value: "expert",
    label: "I'm an experienced coder",
    hint: "I write code regularly and want the AI as a collaborator, not a tutor.",
  },
];

export function ScientistIntakeForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [researchField, setResearchField] = useState<ScientistResearchField>("biology");
  const [specialization, setSpecialization] = useState("");
  const [selectedDataTypes, setSelectedDataTypes] = useState<Set<ScientistDataType>>(new Set());
  const [selectedGoals, setSelectedGoals] = useState<Set<ScientistGoal>>(new Set());
  const [computePreference, setComputePreference] =
    useState<ScientistComputePreference>("local-smolvm");
  const [experienceLevel, setExperienceLevel] = useState<ScientistExperienceLevel>("some_code");

  const toggleDataType = useCallback((value: ScientistDataType) => {
    setSelectedDataTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const toggleGoal = useCallback((value: ScientistGoal) => {
    setSelectedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const canProceed = () => {
    if (step === 0) return true;
    if (step === 1) return selectedDataTypes.size > 0;
    if (step === 2) return selectedGoals.size > 0;
    if (step === 3) return true;
    return true;
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveScientistProfile({
        research_field: researchField,
        specialization: specialization.trim() || undefined,
        data_types: Array.from(selectedDataTypes),
        goals: Array.from(selectedGoals),
        compute_preference: computePreference,
        experience_level: experienceLevel,
      });
      try {
        localStorage.setItem("local-studio-scientist-mode", "true");
      } catch {}
      try {
        localStorage.setItem("local-studio-setup-complete", "true");
      } catch {}
      router.push("/scientist/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile");
    } finally {
      setSaving(false);
    }
  }, [
    researchField,
    specialization,
    selectedDataTypes,
    selectedGoals,
    computePreference,
    experienceLevel,
    router,
  ]);

  const steps = [
    {
      title: "What field do you work in?",
      subtitle: "This helps us tailor the tools and suggestions to your domain.",
      content: (
        <div className="space-y-4">
          <Select
            value={researchField}
            onChange={(e) => setResearchField(e.target.value as ScientistResearchField)}
          >
            {RESEARCH_FIELDS.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </Select>
          <FormField
            label="Specialization (optional)"
            description="e.g., 'marine ecology', 'catalysis', 'NLP'"
          >
            <Input
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              placeholder="Describe your specific area"
            />
          </FormField>
        </div>
      ),
    },
    {
      title: "What kind of data do you work with?",
      subtitle: "Select all that apply. This helps us suggest the right tools and templates.",
      content: (
        <div className="space-y-2">
          {DATA_TYPES.map((dt) => (
            <CheckboxRow
              key={dt.value}
              checked={selectedDataTypes.has(dt.value)}
              onChange={() => toggleDataType(dt.value)}
              label={dt.label}
              description={dt.hint}
            />
          ))}
        </div>
      ),
    },
    {
      title: "What do you want to do?",
      subtitle: "Select all that apply. We'll set up your workspace with the right starting point.",
      content: (
        <div className="space-y-2">
          {GOALS.map((goal) => (
            <CheckboxRow
              key={goal.value}
              checked={selectedGoals.has(goal.value)}
              onChange={() => toggleGoal(goal.value)}
              label={goal.label}
              description={goal.hint}
            />
          ))}
        </div>
      ),
    },
    {
      title: "How should code run?",
      subtitle: "You can change this later. Pick whatever feels right for now.",
      content: (
        <div className="space-y-2">
          {COMPUTE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                computePreference === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border-hover"
              }`}
            >
              <input
                type="radio"
                name="compute"
                value={opt.value}
                checked={computePreference === opt.value}
                onChange={() => setComputePreference(opt.value)}
                className="mt-1"
              />
              <div>
                <div className="font-medium">{opt.label}</div>
                <div className="text-sm text-muted-foreground">{opt.hint}</div>
              </div>
            </label>
          ))}
        </div>
      ),
    },
    {
      title: "How much do you want to code?",
      subtitle: "This adjusts how much the AI explains versus just does.",
      content: (
        <div className="space-y-2">
          {EXPERIENCE_LEVELS.map((level) => (
            <label
              key={level.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                experienceLevel === level.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border-hover"
              }`}
            >
              <input
                type="radio"
                name="experience"
                value={level.value}
                checked={experienceLevel === level.value}
                onChange={() => setExperienceLevel(level.value)}
                className="mt-1"
              />
              <div>
                <div className="font-medium">{level.label}</div>
                <div className="text-sm text-muted-foreground">{level.hint}</div>
              </div>
            </label>
          ))}
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold">Welcome to Local Studio</h1>
        <p className="mt-2 text-muted-foreground">
          Let&apos;s set up your workspace. This takes about a minute.
        </p>
      </div>

      <div className="mb-6 flex items-center justify-center gap-2">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-8 rounded-full transition-colors ${
              i <= step ? "bg-primary" : "bg-border"
            }`}
          />
        ))}
      </div>

      <Card className="p-6">
        <div className="mb-2">
          <h2 className="text-lg font-semibold">{current.title}</h2>
          <p className="text-sm text-muted-foreground">{current.subtitle}</p>
        </div>
        <div className="mt-4">{current.content}</div>

        {error && (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-6 flex justify-between">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? router.push("/setup") : setStep(step - 1))}
            disabled={saving}
          >
            {step === 0 ? "Use technical setup instead" : "Back"}
          </Button>
          {isLast ? (
            <Button onClick={handleSave} disabled={saving || !canProceed()}>
              {saving ? "Saving..." : "Get started"}
            </Button>
          ) : (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()}>
              Continue
            </Button>
          )}
        </div>
      </Card>

      <div className="mt-4 text-center text-sm text-muted-foreground">
        Step {step + 1} of {steps.length}
      </div>
    </div>
  );
}
