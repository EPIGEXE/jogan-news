// ============================================================================
// 개발용 화면 캡처
//
// [역할]
// - 창을 그린 뒤 화면을 PNG로 저장하고 앱 종료 (화면 확인 자동화)
// - 저장 전에 시작 화면 이동과 키 · 마우스 입력을 순서대로 흉내 냄
// - 입력은 wheel · drag · move · click · alt+키 모양을 먼저 확인하고, 어느 것도 아니면 키 이름으로 처리
// - 입력 하나를 넣을 때마다 화면이 바뀔 시간을 잠깐 기다림
// - 창이 없으면 아무것도 하지 않음
// - 개발 중에만 사용 (설치판에서는 쓰지 않음)
// ============================================================================
import { writeFileSync } from 'node:fs'
import { app } from 'electron'
import type { Route } from '@shared/ipc'
import type { MainWindow } from '../platform/window'

/**
 * 창을 그린 뒤 화면을 PNG로 저장하고 종료
 * - 환경 변수: AINEWS_SCREENSHOT=<파일.png>, AINEWS_ROUTE=<시작 화면>, AINEWS_KEYS=<쉼표로 구분한 입력>
 * - 입력 예: Enter,j,wheel:800,click:900:120,drag:804:400:600,move:400:420,alt+Left
 * - AINEWS_SIZE=<너비x높이>로 창 크기 변경 가능
 *
 * @param {MainWindow} mainWindow - 캡처할 창
 * @param {string} screenshotPath - PNG를 저장할 파일 경로
 * @param {Route} [route] - 캡처 전에 이동할 화면
 * @param {string[]} [inputSteps] - 캡처 전에 순서대로 흉내 낼 키 · 마우스 입력
 * @returns {void}
 */
export function captureAndQuit(mainWindow: MainWindow, screenshotPath: string, route?: Route, inputSteps: string[] = []): void {
    // 창이 아직 없으면 캡처할 것 없음
    const browserWindow = mainWindow.browserWindow
    if (!browserWindow) return
    const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)) // 화면이 바뀔 시간을 주는 대기

    // 화면을 다 불러온 뒤에 한 번만 실행
    browserWindow.webContents.once('did-finish-load', async () => {
        // AINEWS_SIZE=1920x1050 → 그 창 크기로 확인
        const sizeMatch = /^(\d+)x(\d+)$/.exec(process.env['AINEWS_SIZE'] ?? '')
        if (sizeMatch) browserWindow.setContentSize(Number(sizeMatch[1]), Number(sizeMatch[2]))
        await wait(2500)

        // 시작 화면을 받았으면 창을 띄우고 그 화면으로 이동
        if (route) mainWindow.show(route)
        await wait(1200)

        // 입력을 순서대로 흉내 냄 (모양이 맞는 것 하나만 처리하고 다음 입력으로)
        for (const inputStep of inputSteps) {
            // wheel:N → 창 가운데에서 아래로 N픽셀 스크롤
            const wheelMatch = /^wheel:(-?\d+)$/.exec(inputStep)
            if (wheelMatch) {
                const [contentWidth, contentHeight] = browserWindow.getContentSize()
                browserWindow.webContents.sendInputEvent({
                    type: 'mouseWheel',
                    x: Math.round(contentWidth! / 2),
                    y: Math.round(contentHeight! / 2),
                    deltaX: 0,
                    deltaY: -Number(wheelMatch[1]) // 아래로 스크롤은 음수
                })
                await wait(500)
                continue
            }

            // drag:X1:Y:X2 → (X1, Y)에서 X2까지 가로로 끎
            const dragMatch = /^drag:(\d+):(\d+):(\d+)$/.exec(inputStep)
            if (dragMatch) {
                const [dragStartX, dragY, dragEndX] = [Number(dragMatch[1]), Number(dragMatch[2]), Number(dragMatch[3])]
                // 시작 위치에서 누르고, 10번에 나눠 조금씩 옮긴 뒤, 끝 위치에서 뗌
                browserWindow.webContents.sendInputEvent({ type: 'mouseDown', x: dragStartX, y: dragY, button: 'left', clickCount: 1 })
                for (let moveIndex = 1; moveIndex <= 10; moveIndex++) {
                    browserWindow.webContents.sendInputEvent({
                        type: 'mouseMove',
                        x: Math.round(dragStartX + ((dragEndX - dragStartX) * moveIndex) / 10),
                        y: dragY,
                        button: 'left'
                    })
                    await wait(30)
                }
                browserWindow.webContents.sendInputEvent({ type: 'mouseUp', x: dragEndX, y: dragY, button: 'left', clickCount: 1 })
                await wait(500)
                continue
            }

            // move:X:Y → 마우스를 그 위치로 옮김 (마우스를 올렸을 때 모습 확인)
            const moveMatch = /^move:(\d+):(\d+)$/.exec(inputStep)
            if (moveMatch) {
                browserWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Number(moveMatch[1]), y: Number(moveMatch[2]) })
                await wait(800)
                continue
            }

            // click:X:Y → 그 위치를 마우스로 누름
            const clickMatch = /^click:(\d+):(\d+)$/.exec(inputStep)
            if (clickMatch) {
                const [clickX, clickY] = [Number(clickMatch[1]), Number(clickMatch[2])]
                browserWindow.webContents.sendInputEvent({ type: 'mouseDown', x: clickX, y: clickY, button: 'left', clickCount: 1 })
                browserWindow.webContents.sendInputEvent({ type: 'mouseUp', x: clickX, y: clickY, button: 'left', clickCount: 1 })
                await wait(500)
                continue
            }

            // alt+Left → Alt를 누른 채 그 키 (뒤로 · 앞으로 확인)
            const altKeyMatch = /^alt\+(.+)$/.exec(inputStep)
            if (altKeyMatch) {
                browserWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: altKeyMatch[1]!, modifiers: ['alt'] })
                browserWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: altKeyMatch[1]!, modifiers: ['alt'] })
                await wait(500)
                continue
            }

            // 그 밖에는 키 이름으로 보고 한 번 누름 (한 글자면 글자 입력도 함께)
            browserWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: inputStep })
            if (inputStep.length === 1) browserWindow.webContents.sendInputEvent({ type: 'char', keyCode: inputStep })
            browserWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: inputStep })
            await wait(500)
        }

        // 마지막 입력의 결과가 그려지기를 기다린 뒤 화면을 PNG로 저장하고 앱 종료
        await wait(1500)
        writeFileSync(screenshotPath, (await browserWindow.webContents.capturePage()).toPNG())
        app.quit()
    })
}
