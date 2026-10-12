# 관리자 대화 연결

이 기능은 사이트 안에서 대진 도우미와 대화하고, 제안한 조건을 기존 편성기로 미리보기 만드는 기능이다. 공개 화면의 대진·점수 기능은 유지한다. AI가 확정 기록을 저장하거나 수정하는 기능은 제공하지 않는다.

## 현재 상태

구현 및 로컬 검증용 코드다. Firebase Authentication 설정, 관리자 계정 등록, Functions 배포, OpenAI API 설정 후 사용할 수 있다. 프런트엔드의 `VITE_ADMIN_CHAT_ENABLED`는 기본적으로 `false`다. 기존 ChatGPT 대화나 ChatGPT 구독 계정을 그대로 사용하는 기능은 아니다.

## 관리자 계정

1. Firebase 콘솔의 Authentication에서 이메일/비밀번호 로그인을 활성화한다.
2. 기본 담당자의 계정을 먼저 만들고 이름을 등록한다. 비밀번호는 콘솔에서 관리하며 저장소나 대화에 적지 않는다.
3. 프로젝트 관리자 권한의 Application Default Credentials를 사용해 아래 명령으로 기존 계정에 `gdrAdmin` 권한을 부여한다. 사전 조회 후 `--apply`로 적용한다.

```sh
node scripts/grant-chat-admin.js --project PROJECT_ID --uid FIREBASE_AUTH_UID
node scripts/grant-chat-admin.js --project PROJECT_ID --uid FIREBASE_AUTH_UID --apply
```

추가 계정도 같은 방식으로 등록한다. 기존 사용자 정보와 다른 권한은 유지한다. 필요하면 `--display-name`으로 표시 이름을 지정할 수 있다. 권한 변경 후 다시 로그인한다.

브라우저에서 처음 로그인한 계정의 이메일을 기본 입력값으로 기억한다. 비밀번호는 저장하지 않으며 로그인은 브라우저 세션 동안 유지한다. `계정 변경`으로 로그아웃하고 다른 관리자 계정으로 로그인할 수 있다.

## AI 서버

Node.js 22와 Firebase CLI를 준비한다. Functions 배포가 가능한 프로젝트 결제 설정과 관리자 권한이 필요하다. API 키는 Secret Manager에만 등록한다.

```sh
firebase functions:secrets:set OPENAI_API_KEY --project PROJECT_ID
firebase deploy --only functions:adminChat,functions:adminChatState --project PROJECT_ID
```

`OPENAI_MODEL`은 배포 시 사용할 Responses API 모델 ID로 설정한다. 서버는 `text.format`의 JSON Schema 형식을 지원하는 모델을 사용해야 한다. 모델을 자동으로 선택하거나 계정의 사용 가능 모델을 가정하지 않는다.

두 callable은 `asia-northeast3`에 배포한다. 허용 origin은 현재 GitHub Pages 주소와 로컬 개발 주소다. 호스팅 주소 변경 시 서버의 CORS 설정도 확인한다.

## 화면 활성화

연결 설정이 완료되면 로컬 `.env.local`에 `VITE_ADMIN_CHAT_ENABLED=true`를 추가해 빌드하고 별도로 사이트를 배포한다. API 키를 `VITE_` 환경 변수로 넣으면 안 된다.

`관리자` 버튼 → 로그인 → 에이전트 선택 → 조건 입력 → 설정 제안 확인 → `대진 미리보기 만들기` → 기존 대진 편성 화면에서 확인 후 확정 순서로 사용한다.

지원 설정: 모임 날짜·시간, 참석자·게스트, 고정 페어, 개인 경기 수, 먼저 마무리/나중에 시작 선호. 지원하지 않는 조건은 자동 반영하지 않는다. 등록된 분기 명단이 없는 날짜나 이미 확정된 날짜에는 미리보기를 적용하지 않는다.

## 대화 보관과 접근

대화는 계정 UID와 에이전트별로 분리하고 서버의 callable로만 읽고 쓴다. 현재 Firestore 규칙의 기본 거부 규칙이 관리자 대화 경로의 브라우저 직접 접근을 막는다. 인증 및 실제 관리자 권한 확인은 모든 callable에서 수행한다. 계정 전환 시 이전 대화·제안을 화면에서 지우고 이전 요청의 늦은 응답도 무시한다.

사용자의 메시지, 참석 명단, 편성 조건은 AI 응답 생성을 위해 OpenAI API에 전송한다. 비밀번호, API 키, 내부 평가값, 다른 계정의 대화는 전송하지 않는다. `store: false`를 사용한다. 보관하는 대화는 계정·에이전트별 최근 40개 메시지, AI 입력은 최근 30개 메시지로 제한한다. 대화 저장 경로는 `clubs/gdr/adminChats/{uid}/agents/{agentId}`다.

계정별 호출 한도는 분당 6회·UTC 날짜 기준 하루 60회다. 같은 요청 ID의 마지막 완료 응답은 다시 과금 요청하지 않고 돌려준다. 동시에 진행되는 같은 에이전트의 요청은 거부하며 중복 요청을 줄인다.

## 검증 범위

API 키와 서버 배포 권한이 없는 환경에서는 실제 로그인과 유료 AI 호출을 검증할 수 없다. 구조화 응답·거부·오류 처리·설정 검증은 모의 응답으로 검증하며, 실제 연결 검증은 서버 설정 후 별도로 수행한다.
