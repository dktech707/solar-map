/** Shape of every error body returned by the Express API. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
