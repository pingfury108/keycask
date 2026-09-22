/**
 * RSA-OAEP-SHA1 解密（EncString type 4：组织密钥的分发格式）。
 * 私钥为 PKCS8 DER（profile.PrivateKey 用 User Key 解密后的字节）。
 */
export async function rsaOaepSha1Decrypt(
  ciphertext: Uint8Array,
  privateKeyDer: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-1' },
    false,
    ['decrypt'],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, ciphertext as BufferSource),
  );
}
