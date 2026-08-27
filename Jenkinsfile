// yt-redirect-pin — .github/workflows/ci.yml の移植。
// 元: node 20 / typecheck -> test -> package
// package まで回すのは「壊れた配布物のままタグを切らない」ため(元 yml のコメント通り)。
pipeline {
  agent {
    docker {
      image 'node:20-bookworm'
      args '-e HOME=/tmp -e npm_config_cache=/tmp/.npm'
    }
  }
  options {
    timestamps()
    timeout(time: 20, unit: 'MINUTES')
    disableConcurrentBuilds(abortPrevious: true)
  }
  stages {
    stage('install')   { steps { sh 'npm ci' } }
    stage('typecheck') { steps { sh 'npm run typecheck' } }
    stage('test')      { steps { sh 'npm test' } }
    stage('package')   { steps { sh 'npm run package' } }
  }
  post { always { cleanWs() } }
}
