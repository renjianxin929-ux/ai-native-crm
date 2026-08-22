export type CustomerCaptureInputKind = 'text' | 'image' | 'document';

export const CUSTOMER_CAPTURE_CONTRACT: Readonly<Record<CustomerCaptureInputKind, {
  readonly enabled: true;
  readonly processing: 'future_pipeline_only';
}>> = Object.freeze({
  text: { enabled: true, processing: 'future_pipeline_only' },
  image: { enabled: true, processing: 'future_pipeline_only' },
  document: { enabled: true, processing: 'future_pipeline_only' },
});
