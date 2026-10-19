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

PUT은 Content-Type: application/json이 필요합니다. API_TOKEN 설정 시 Authorization: Bearer <token>을 보내세요. 업데이트 시 서버가 updatedAt을 생성합니다. 동시 편집은 마지막 저장이 우선합니다.

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

음표는 { id, pitch, step, length, velocity }입니다. UUID ID, MIDI pitch 60–72, step 0–127, 양의 정수 length, velocity 0.01–1을 허용합니다. 음표 최대 512개, BPM 40–240, 8마디입니다. recording은 null 또는 { dataUrl, duration, offset }이며 오디오 data URL, 초 단위 길이(최대 120초)와 시작 보정(-5~48초)을 저장합니다. 클라이언트 녹음 한도는 20 MB이며 API 요청은 base64 포함 최대 30 MiB입니다.

## 저장 및 검증

프로젝트마다 DATA_DIR/<uuid>.json 파일을 사용합니다. 임시 파일 작성 후 rename으로 원자적으로 교체하며 허용한 필드만 저장합니다. 사용자 데이터와 .env는 Git에서 제외됩니다. 단일 프로세스의 로컬 디스크 사용을 전제로 하며, 다중 인스턴스 운영 전 데이터베이스와 오브젝트 스토리지로 이전해야 합니다.

```sh
npm test
```

테스트는 임시 디렉터리와 임의의 루프백 포트로 CRUD, 영속 파일, CORS, 인증, 입력 검증, 경로 조작과 크기 제한을 확인합니다.

프론트엔드: https://github.com/solchaan/mumak-front
