export default class SafeReporter {
  onBegin(_config, suite) { process.stdout.write(`CMS_E2E DISCOVERY ${suite.allTests().length} cases\n`) }
  onTestEnd(test, result) {
    // Static case titles only. Never print errors, steps, attachments, stdout,
    // browser call logs, storage state or credential-bearing environment values.
    const title = test.title.replace(/[^\p{L}\p{N} _.,:/()=-]/gu, '').slice(0, 180)
    process.stdout.write(`CMS_E2E CASE ${title} ${result.status}\n`)
  }
  onError() { process.stdout.write('CMS_E2E RESULT infrastructure-error-details-redacted\n') }
  onEnd(result) { process.stdout.write(`CMS_E2E RESULT ${result.status}\n`) }
}
