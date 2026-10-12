import { Component, type ReactNode } from "react";
import { Alert, Button } from "@mui/material";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Catches render-time crashes (e.g. a malformed JSON document reaching the
 * ticket forum or the JSON viewer) and shows a small error instead of
 * white-screening the whole page. "Retry" resets the boundary so the section
 * re-renders with the current data.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const message = this.state.error.message || "Something went wrong rendering this section.";
      return (
        <Alert
          severity="error"
          sx={{ m: 1 }}
          action={
            <Button color="inherit" size="small" onClick={this.handleRetry}>
              Retry
            </Button>
          }
        >
          {message}
        </Alert>
      );
    }
    return this.props.children;
  }
}
