// wsl.exe can return 0 while its status text reports missing virtualization.
export function wslStatusReady(result) {
  if (result.status !== 0 || result.error) return false;
  const decode = value => {
    if (!value) return '';
    if (typeof value === 'string') return value.replaceAll('\0', '');
    return value.toString(value.includes(0) ? 'utf16le' : 'utf8');
  };
  const output = `${decode(result.stdout)}\n${decode(result.stderr)}`;
  return !/WSL\s*2\s+(?:is\s+)?(?:unable|not supported)|virtualization\s+is\s+not\s+enabled|enable virtualization|enable.*Virtual Machine Platform/i.test(output);
}
