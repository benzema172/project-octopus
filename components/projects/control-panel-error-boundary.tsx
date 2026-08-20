"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { title: string; children: ReactNode };
type State = { hasError: boolean; message: string | null };

export class ControlPanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : "Nieznany błąd renderowania panelu." };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`Project Octopus: Control 360 client panel failed: ${this.props.title}`, error, info);
  }

  private retry = () => this.setState({ hasError: false, message: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <section className="execution-layer-notice" role="alert">
        <AlertTriangle size={22} aria-hidden="true" />
        <div>
          <strong>{this.props.title} nie załadował się poprawnie</strong>
          <p>{this.state.message ?? "Nieznany błąd renderowania panelu."} Pozostałe części Kontroli 360 nadal działają.</p>
          <button type="button" className="secondary-button" onClick={this.retry}>
            <RotateCcw size={15} aria-hidden="true" /> Ponów panel
          </button>
        </div>
      </section>
    );
  }
}
