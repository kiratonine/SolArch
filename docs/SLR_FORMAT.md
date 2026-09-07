# SolArch — `.slr` Format v1

**Status:** hackathon/MVP format specification  
**Extension:** `.slr`  
**MIME suggestion:** `application/x-solarch`

---

## 1. Goals

`.slr` — собственный self-contained encrypted container.

Format v1 должен:

- переносить encrypted protected content как один файл;
- позволять Viewer безопасно прочитать public header до payment;
- не раскрывать content key;
- обнаруживать повреждение/подмену;
- поддерживать chunked decryption;
- поддерживать internal file listing после unlock;
- быть пригодным для file-first distribution.

---

## 2. Non-goals

`.slr` не является:

- ZIP/RAR-compatible extension;
- executable;
- blockchain storage format;
- абсолютным DRM;
- местом хранения plaintext content key.

---

## 3. Logical layout

Рекомендуемая логическая структура:

```text
+------------------------------+
| Magic                        |
+------------------------------+
| Format version               |
+------------------------------+
| Header length / offsets      |
+------------------------------+
| Public Header                |
+------------------------------+
| Encrypted Manifest           |
+------------------------------+
| Encrypted Chunk Index        |
+------------------------------+
| Encrypted Data Chunks        |
+------------------------------+
| Signature / Integrity Block  |
+------------------------------+
```

Точное binary encoding и field widths определяет `solarch-core`, но v1 parser обязан быть versioned.

---

## 4. Magic and version

Пример magic identifier:

```text
SOLARCH
```

или equivalent fixed bytes.

Обязательно хранить:

```text
format_version
```

Viewer не должен пытаться читать неизвестную major version как совместимую.

---

## 5. Public Header

Public Header доступен до оплаты.

Минимальные поля:

```json
{
  "format": "solarch",
  "version": "1.0.0",
  "archive_id": "arc_...",
  "created_at": "...",
  "title": "Premium Course",
  "creator_wallet": "...",
  "commercial_snapshot": {
    "price_amount": "10.00",
    "price_currency": "USDC",
    "platform_fee_bps": 500
  },
  "license_snapshot": {
    "max_devices": 1,
    "allow_export": false,
    "watermark_enabled": true
  },
  "backend": {
    "archive_api_id": "arc_..."
  },
  "crypto": {
    "content_algorithm": "...",
    "chunk_size": 1048576
  }
}
```

### Important

Public Header является signed snapshot, но Backend остаётся authoritative для:

- archive status;
- payment intent;
- payout recipients;
- payment verification;
- entitlement/license.

Price immutable, поэтому snapshot должен совпадать с Backend; при mismatch Viewer должен остановить payment и показать integrity/configuration error.

---

## 6. Encrypted Manifest

После расшифровки содержит внутреннюю структуру:

```json
{
  "archive_id": "arc_...",
  "files": [
    {
      "file_id": "file_001",
      "path": "course/lesson-01.pdf",
      "display_name": "lesson-01.pdf",
      "mime_type": "application/pdf",
      "size_bytes": 2452344,
      "hash": "...",
      "chunks": [0, 1, 2],
      "viewer_policy": {
        "internal_viewer_only": true,
        "export_allowed": false,
        "watermark_required": true
      }
    }
  ]
}
```

Encrypted Manifest не совпадает с Marketplace Public Listing.

---

## 7. Public Listing vs Encrypted Manifest

Marketplace Public Listing хранится на Backend отдельно.

Public listing может содержать:

```text
display_path
display_name
extension
mime_type
size_bytes
```

Encrypted Manifest дополнительно содержит внутренние технические поля.

Marketplace никогда не получает из `.slr`:

- content key;
- raw chunk map for public API;
- private crypto metadata beyond safe public fields;
- internal storage paths.

---

## 8. Crypto requirements

Для MVP использовать проверенные библиотеки.

Допустимая модель:

```text
AEAD:
XChaCha20-Poly1305
or AES-256-GCM

Signatures:
Ed25519

Key agreement / wrapping:
X25519-based scheme or audited equivalent

Hash:
SHA-256 or BLAKE3

KDF:
HKDF
```

Нельзя писать собственный crypto primitive.

---

## 9. Key hierarchy

Концептуально:

```text
Archive Content Key
        ↓
Derived File/Chunk Keys
        ↓
Encrypted Chunks
```

Rules:

- Archive Content Key отсутствует plaintext в `.slr`;
- Viewer получает wrapped key только после Device License;
- device private key остаётся локально;
- nonce никогда не должен переиспользоваться с одним ключом в unsafe way.

---

## 10. Chunking

Protected content шифруется чанками.

Рекомендуемый MVP default:

```text
1 MiB
```

или другой единый размер, зафиксированный реализацией.

Benefits:

- ограниченное потребление памяти;
- partial decryption;
- faster file access;
- integrity failure локализуется.

---

## 11. Supported MIME classes

MVP:

```text
application/pdf
image/png
image/jpeg
image/webp
application/vnd.openxmlformats-officedocument.wordprocessingml.document
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

Другие protected content types должны отклоняться либо маркироваться unsupported до публикации.

---

## 12. Safe paths

При сборке container:

- normalize path;
- forbid absolute paths;
- forbid `../` traversal;
- forbid duplicate canonical paths;
- impose file count/size limits;
- reject executable payloads per security policy.

---

## 13. Integrity

Viewer должен обнаруживать:

- modified public header;
- modified encrypted manifest;
- modified chunk;
- truncated file;
- invalid signature;
- unsupported version.

Fail closed:

```text
Integrity check failed
→ do not decrypt/open content
```

---

## 14. Signature

Container должен иметь platform/server signing strategy, позволяющую Viewer проверить, что protected structure не была подменена после generation.

Private signing key не хранится в Viewer repository.

---

## 15. Viewer behavior

On open:

```text
1. Validate magic/version.
2. Parse Public Header.
3. Validate basic structure.
4. Verify signature/integrity.
5. Ask Backend for current archive state.
6. If no valid local license → Locked.
7. If valid license → unwrap content key.
8. Decrypt manifest.
9. Render selected files by chunks.
```

---

## 16. Export policy

Для MVP flagship behavior:

```text
allow_export = false
```

Viewer не предоставляет:

```text
Extract All
Save As
Open External
```

для protected content.

Это practical DRM, а не абсолютная защита.

---

## 17. Versioning

Любое несовместимое изменение binary layout повышает major format version.

Backward compatibility реализуется явно через parser dispatch:

```text
v1 parser
future v2 parser
```

Не добавлять неявные heuristics для неизвестных версий.

---

## 18. Test vectors

`solarch-core` должен иметь стабильные test vectors:

- minimal valid `.slr`;
- multi-file `.slr`;
- corrupted header;
- corrupted manifest;
- corrupted chunk;
- invalid signature;
- unsupported version.

Эти fixtures используются Viewer и Backend integration tests.
