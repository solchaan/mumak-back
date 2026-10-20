# Mumak · Backend

Mumak 음악 스케치북의 단일 사용자 프로젝트 저장 API입니다. Node.js 내장 HTTP 서버와 파일 저장소를 사용하며 추가 런타임 의존성이 없습니다.

## 실행

Node.js 22.12 이상이 필요합니다.

```sh
cp .env.example .env
npm start
# 변경 감지 개발 모드
npm run dev
```

기본 주소는 http://127.0.0.1:3001 입니다. 프론트의 **프로젝트 서버**에서 연결하세요. 브라우저 자동 저장과 별도로 사용자가 저장 버튼을 누를 때 전송합니다.

## 설정

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| HOST | 127.0.0.1 | 수신 인터페이스 |
| PORT | 3001 | HTTP 포트 |
| DATA_DIR | ./data | 프로젝트 저장 폴더 |
| ALLOWED_ORIGINS | http://127.0.0.1:5173,http://localhost:5173 | 쉼표로 구분한 허용 출처 |
| API_TOKEN | 빈 값 | 설정 시 모든 API에 Bearer 인증 적용 |

루프백 외부 인터페이스에서는 최소 32자 API 토큰이 필수입니다. 인터넷 배포 시 HTTPS 프록시, 정확한 CORS 출처, 데이터 볼륨·백업을 설정하세요. 현재 토큰은 서버 전체에 대한 단일 사용자 자격 증명입니다. 다중 사용자 계정과 프로젝트 소유권은 아직 없습니다.

## API

| 메서드 | 경로 | 응답 |
| --- | --- | --- |
| GET | /api/health | 상태와 형식 버전 |
| GET | /api/projects | projects 배열: id, title, bpm, updatedAt |
| GET | /api/projects/:id | 전체 프로젝트 |
| PUT | /api/projects/:id | 생성 또는 교체, id와 updatedAt |
| DELETE | /api/projects/:id | 삭제, 204 |
| POST | /api/harmony/suggest | 조성 추정과 다음 코드·코드 진행 추천 |

PUT과 POST는 Content-Type: application/json이 필요합니다. API_TOKEN 설정 시 Authorization: Bearer <token>을 보내세요. 업데이트 시 서버가 updatedAt을 생성합니다. 동시 편집은 마지막 저장이 우선합니다.

프로젝트 형식 v1:

```json
{
  "version": 1,
  "id": "12345678-1234-1234-1234-123456789abc",
  "title": "새로운 아이디어",
  "bpm": 96,
  "bars": 8,
  "instrument": "soft",
  "notes": [],
  "drums": { "kick": [0, 8], "snare": [4, 12], "hat": [] },
  "mixer": {
    "keys": { "volume": 0.7, "mute": false },
    "drums": { "volume": 0.55, "mute": false },
    "voice": { "volume": 0.8, "mute": false }
  },
  "recording": null,
  "updatedAt": "2026-10-19T00:00:00.000Z"
}
```

음표는 { id, pitch, step, length, velocity }입니다. UUID ID, MIDI pitch 60–84, step 0–127, 양의 정수 length, velocity 0.01–1을 허용합니다. 음표 최대 512개, BPM 40–240, 8마디입니다. recording은 null 또는 { dataUrl, duration, offset }이며 오디오 data URL, 초 단위 길이(최대 120초)와 시작 보정(-5~48초)을 저장합니다. 클라이언트 녹음 한도는 20 MB이며 API 요청은 base64 포함 최대 30 MiB입니다.

## 저장 및 검증

프로젝트마다 DATA_DIR/<uuid>.json 파일을 사용합니다. 임시 파일 작성 후 rename으로 원자적으로 교체하며 허용한 필드만 저장합니다. 사용자 데이터와 .env는 Git에서 제외됩니다. 단일 프로세스의 로컬 디스크 사용을 전제로 하며, 다중 인스턴스 운영 전 데이터베이스와 오브젝트 스토리지로 이전해야 합니다.

```sh
npm test
```

테스트는 임시 디렉터리와 임의의 루프백 포트로 CRUD, 영속 파일, CORS, 인증, 입력 검증, 경로 조작과 크기 제한을 확인합니다.

프론트엔드: https://github.com/solchaan/mumak-front


## 오선지 확장 필드

프로젝트 v1은 선택적 chords 배열과 음표의 선택적 spelling 필드를 지원합니다. 기존 파일에 chords가 없으면 빈 배열로 처리합니다.

- spelling: 실제 MIDI 음높이와 일치하는 음이름, 예: Bb4, F#5, Bbb4. 겹임시표까지 허용합니다.
- chords: { id, symbol, step, length } 배열. 리드시트 방식의 코드 기호로, 구성음은 음표로 저장하지 않고 클라이언트가 재생·내보내기 때 기호로부터 만듭니다. 위치순으로 정렬해 저장합니다.
- 같은 시작 위치의 중복 코드, 중복 ID, 지원하지 않는 기호와 잘못된 음이름은 거부합니다. 이전 클라이언트가 보내던 noteIds 필드는 문자열 배열이면 받아들이되 저장하지 않습니다.
- 지원 코드: 메이저, m, 7, maj7, m7, dim, dim7, m7b5, aug, sus2, sus4, 6, m6. 세 겹 임시표가 필요한 Cbdim7/B#aug는 지원하지 않습니다.
- accompaniment: { pattern } 코드 반주 패턴. pattern은 quarter(4비트, 기본값), half, eighth, whole 중 하나입니다. 필드가 없으면 quarter로 저장합니다. 반주 음표 자체는 클라이언트가 코드 기호에서 생성하므로 저장하지 않습니다.
- key: null 또는 { tonic, mode } 조표. mode는 major 또는 minor이며 tonic은 정해진 표기만 허용합니다. 장조: C, Db, D, Eb, E, F, Gb, G, Ab, A, Bb, B. 단조: C, C#, D, Eb, E, F, F#, G, G#, A, Bb, B. 필드가 없으면 null로 저장합니다. 조표가 있으면 코드 추천은 조성 추정 대신 이 값을 사용합니다.

필드가 없는 기존 프로젝트의 읽기는 유지되며, 새 코드 데이터를 저장할 때는 프론트와 백엔드를 함께 업데이트해야 합니다.

## 코드 진행 추천

POST /api/harmony/suggest는 외부 서비스 없이 규칙 기반으로 다음 코드를 추천합니다. 요청은 저장과 무관하며 프로젝트를 읽거나 쓰지 않습니다. 본문 한도는 1 MiB입니다.

요청 본문(모든 필드 선택):

```json
{
  "step": 16, "length": 16, "limit": 6,
  "notes": [{ "id": "…", "pitch": 64, "step": 16, "length": 8, "velocity": 0.7 }],
  "chords": [{ "symbol": "G7", "step": 0, "length": 16, "noteIds": ["…"] }],
  "key": { "tonic": "C", "mode": "major" }
}
```

- step·length: 추천할 코드의 시작 위치와 길이(16분음표 칸). 기본값은 0과 16입니다.
- notes·chords: 현재 스케치의 음표와 코드. 녹음 데이터는 보내지 않습니다.
- key: 지정하면 조성 추정을 건너뜁니다. tonic은 C, Db/C#, …, B, mode는 major 또는 minor입니다.

응답:

```json
{
  "key": { "tonic": "C", "mode": "major", "label": "C 장조", "confidence": 0.84, "estimated": true },
  "position": { "step": 16, "length": 16 },
  "previous": { "symbol": "G7", "roman": "V" },
  "suggestions": [{ "symbol": "C", "roman": "I", "score": 1.8, "reason": "V → I 진행 · 멜로디 음 1개 포함" }],
  "progressions": [{ "name": "I–V–vi–IV", "symbols": ["C", "G", "Am", "F"], "chords": [{ "symbol": "C", "step": 0, "length": 16 }] }]
}
```

- 조성은 음표와 코드 구성음의 피치 클래스 분포를 Krumhansl-Kessler 프로파일과 비교해 추정합니다. 속7화음은 5도 아래 조성에 가중치를 더합니다.
- 후보는 해당 조성의 다이어토닉 3화음과 7화음입니다. 점수는 직전 코드에서의 기능 화성 전이, 다음 코드로의 연결, 구간 멜로디와의 구성음 일치, 8마디 끝의 마침·반종지 보너스, 직전 코드 반복 감점을 합산합니다.
- step 위치에 이미 코드가 있고 noteIds를 보내면 그 구성음은 멜로디 평가에서 제외합니다.
- progressions는 조성에 맞춘 4코드 상용 진행 네 가지를 8마디(마디당 한 코드)로 펼친 목록입니다.
- analysis.romans는 현재 코드 각각의 로마 숫자 기능(조성 밖이면 null)이고, tips는 진행 전체에 대한 학습용 조언입니다. 각 팁은 { level: good | info | warn, text }이며 최대 6개입니다. 같은 코드 반복, 마침(으뜸·반종지·열린 끝), 딸림·버금딸림 기능 부재, V → IV 역행, 조성 밖 코드, 3화음만 사용, 마디당 코드 밀도, 센 박 멜로디와 코드의 충돌, I–V–vi–IV·ii–V–I 같은 상용 진행 감지를 다룹니다.
- 추천 기호는 모두 프로젝트 검증이 허용하는 코드이며 음역 C4–C6 안에 들어갑니다. 전조, 세컨더리 도미넌트, 차용화음은 아직 제안하지 않습니다.
