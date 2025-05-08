// Initialize AOS animation library
AOS.init({
    duration: 800,
    once: true
});

window.addEventListener('DOMContentLoaded', event => {

    // Navbar shrink function
    var navbarShrink = function () {
        const navbarCollapsible = document.body.querySelector('#mainNav');
        if (!navbarCollapsible) {
            return;
        }
        const threshold = 200; // 设置滚动阈值，例如200像素
        if (window.scrollY < threshold) {
            navbarCollapsible.classList.remove('navbar-shrink');
        } else {
            navbarCollapsible.classList.add('navbar-shrink');
        }
    };

    // Shrink the navbar 
    navbarShrink();

    // Shrink the navbar when page is scrolled
    document.addEventListener('scroll', navbarShrink);

    // Activate Bootstrap scrollspy on the main nav element
    const mainNav = document.body.querySelector('#mainNav');
    if (mainNav) {
        new bootstrap.ScrollSpy(document.body, {
            target: '#mainNav',
            rootMargin: '0px 0px -40%',
        });
    };

    // Collapse responsive navbar when toggler is visible
    const navbarToggler = document.body.querySelector('.navbar-toggler');
    const responsiveNavItems = [].slice.call(
        document.querySelectorAll('#navbarResponsive .nav-link')
    );
    responsiveNavItems.map(function (responsiveNavItem) {
        responsiveNavItem.addEventListener('click', () => {
            if (window.getComputedStyle(navbarToggler).display !== 'none') {
                navbarToggler.click();
            }
        });
    });

    // Activate SimpleLightbox plugin for portfolio items
    new SimpleLightbox({
        elements: '#portfolio a.portfolio-box'
    });

});

const fullscreenToggle = document.getElementById('fullscreenToggle');

fullscreenToggle.addEventListener('click', function () {
    // 如果当前没有处于全屏状态，则请求全屏
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            alert(`Error enabling full-screen mode: ${err.message}`);
        });
        // 切换按钮文字（可选）
        fullscreenToggle.textContent = 'Exit Full Screen';
    } else {
        // 如果已经全屏，则退出全屏
        document.exitFullscreen();
        fullscreenToggle.textContent = 'Full Screen';
    }
});

// 当全屏状态改变时，更新按钮文本
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        fullscreenToggle.textContent = 'Full Screen';
    }
});


