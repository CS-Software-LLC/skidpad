/** The recorded-lap trace format shared by the recorder and the replay. */

export const LAP_RATE = 60;
export const LAP_QUANTUM = 1000;

export interface LapTrace {
  preset: string;
  /** Host steps per second the inputs were recorded at. */
  rate: number;
  /** Inputs are stored as integers over this quantum. */
  quantum: number;
  /** Length of the centreline, m. */
  trackLength: number;
  steps: number;
  steer: number[];
  throttle: number[];
  brake: number[];
  handbrake: number[];
}
