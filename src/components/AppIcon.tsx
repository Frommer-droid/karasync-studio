import React from 'react';

interface AppIconProps {
  className?: string;
  imageClassName?: string;
}

export const AppIcon: React.FC<AppIconProps> = ({
  className = 'w-10 h-10',
  imageClassName = '',
}) => (
  <span className={`app-icon-shell ${className}`} aria-hidden="true">
    <img
      src="/app-icon.png"
      alt=""
      width={256}
      height={256}
      draggable={false}
      className={`app-icon-image ${imageClassName}`}
    />
  </span>
);
