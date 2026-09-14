export interface AttachmentCandidate { name: string; size: number; mime: string }
export interface AttachmentPolicy { maximumBytes: number; allowedMime: readonly string[]; blockedExtensions: readonly string[] }
export interface AttachmentDecision { accepted: boolean; reasons: string[] }
export function inspectAttachment(file: AttachmentCandidate, policy: AttachmentPolicy): AttachmentDecision {
  const reasons: string[] = []
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : ''
  if (!file.name.trim() || file.name.includes('/') || file.name.includes('\\')) reasons.push('File name is invalid.')
  if (file.size <= 0 || file.size > policy.maximumBytes) reasons.push('File size is outside the allowed range.')
  if (!policy.allowedMime.includes(file.mime)) reasons.push('File type is not allowed.')
  if (policy.blockedExtensions.includes(extension)) reasons.push('File extension is blocked.')
  return { accepted: reasons.length === 0, reasons }
}
export function duplicateAttachment(file: AttachmentCandidate, existing: readonly AttachmentCandidate[]): boolean {
  return existing.some(item => item.name.toLowerCase() === file.name.toLowerCase() && item.size === file.size)
}
