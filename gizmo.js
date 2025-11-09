import * as THREE from 'three';

class Gizmo {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

        this.outerSphere = null;
        this.axesHelper = null;
        this.innerBall = null;

        // Physics properties
        this.ballPosition = new THREE.Vector3(0, 0, 0);
        this.ballVelocity = new THREE.Vector3(0, 0, 0);
        this.gravity = new THREE.Vector3(0, -9.8, 0);
        this.clock = new THREE.Clock();
        this.outerRadius = 2.5;
        this.innerRadius = 0.5;

        // Orientation properties
        this.deviceAlphaOffset = 0;
        this.deviceBetaOffset = 0;
        this.deviceGammaOffset = 0;
        this.isCalibrated = false;

        this.gizmoGroup = new THREE.Group();
    }

    init() {
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);
        this.camera.position.z = 5;

        // Outer translucent sphere
        const outerGeometry = new THREE.SphereGeometry(this.outerRadius, 32, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.2
        });
        this.outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
        this.gizmoGroup.add(this.outerSphere);

        // XYZ Axes
        this.axesHelper = new THREE.AxesHelper(2);
        this.gizmoGroup.add(this.axesHelper);

        this.scene.add(this.gizmoGroup);

        // Inner solid ball
        const innerGeometry = new THREE.SphereGeometry(this.innerRadius, 32, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({ color: 0xff88aa });
        this.innerBall = new THREE.Mesh(innerGeometry, innerMaterial);
        this.scene.add(this.innerBall);

        this.renderer.render(this.scene, this.camera);
    }

    calibrateAndStart() {
        if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        this.addOrientationListener();
                    }
                })
                .catch(console.error);
        } else {
            this.addOrientationListener();
        }

        this.animate();
    }

    addOrientationListener() {
        window.addEventListener('deviceorientation', this.handleOrientation.bind(this), true);
    }

    handleOrientation(event) {
        if (!event.alpha || !event.beta || !event.gamma) return;

        if (!this.isCalibrated) {
            // This is now just an initial value, real calibration is on start.
            // It helps prevent wild jumps before calibration.
            this.deviceAlphaOffset = event.alpha;
            this.deviceBetaOffset = event.beta;
            this.deviceGammaOffset = event.gamma;
        }

        const alpha = event.alpha; // Compass
        const beta = event.beta;   // Front-back tilt
        const gamma = event.gamma; // Left-right tilt

        // Convert degrees to radians
        const alphaRad = THREE.MathUtils.degToRad(alpha - this.deviceAlphaOffset);
        const betaRad = THREE.MathUtils.degToRad(beta - this.deviceBetaOffset);
        const gammaRad = THREE.MathUtils.degToRad(gamma - this.deviceGammaOffset);
        
        // Use ZXY order which is common for device orientation
        const euler = new THREE.Euler(betaRad, gammaRad, alphaRad, 'ZXY');
        const q = new THREE.Quaternion().setFromEuler(euler);

        // Correct for screen orientation (assuming portrait mode)
        const screenAdjustment = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), 
            -Math.PI / 2
        );
        q.multiply(screenAdjustment);
        this.gizmoGroup.quaternion.copy(q);

        // Update gravity vector based on device orientation
        const gravityVector = new THREE.Vector3(
            Math.sin(THREE.MathUtils.degToRad(gamma)),
            -Math.sin(THREE.MathUtils.degToRad(beta)),
            -Math.cos(THREE.MathUtils.degToRad(beta)) * Math.cos(THREE.MathUtils.degToRad(gamma))
        ).normalize();

        this.gravity.copy(gravityVector).multiplyScalar(9.8);
    }

    updatePhysics() {
        const deltaTime = Math.min(this.clock.getDelta(), 0.05); // Clamp delta to prevent physics glitches

        // Apply gravity
        this.ballVelocity.addScaledVector(this.gravity, deltaTime);

        // Update position
        this.ballPosition.addScaledVector(this.ballVelocity, deltaTime);

        // Collision with outer sphere
        const distanceFromCenter = this.ballPosition.length();
        if (distanceFromCenter > this.outerRadius - this.innerRadius) {
            // Normalize position vector to get collision normal
            const normal = this.ballPosition.clone().normalize();

            // Reflect velocity
            this.ballVelocity.reflect(normal);

            // Apply friction/damping
            this.ballVelocity.multiplyScalar(0.8);

            // Move ball back inside sphere to prevent sinking
            this.ballPosition.copy(normal).multiplyScalar(this.outerRadius - this.innerRadius);
        }

        this.innerBall.position.copy(this.ballPosition);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.updatePhysics();
        this.renderer.render(this.scene, this.camera);
    }
}

export default Gizmo;